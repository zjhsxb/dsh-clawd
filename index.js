// dsh-clawd — host side
// Clawd娘: a Claude-inspired pixel crab desktop pet for DeepSeek Harness.
// Non-official fan work; "Clawd" is Anthropic's character. Not affiliated with Anthropic.
// Derivative of dsh-pet concepts (MIT, https://github.com/PC2005-cloud/dsh-pet).

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const name = 'clawd';
export const inject = ['webServer'];

const ROUTE_SEGMENT = '/dsh-clawd-7788';
const TASK_TEXT_MAX = 40;
const TERMINAL_CLEAR_MS = 8000;

const WORK_STATUS_PRIORITY = {
  waiting: 60,
  error: 50,
  working: 40,
  thinking: 30,
  result: 25,
  success: 20,
};

// ---------------------------------------------------------------------------
// Work-status folding (semantics ported from dsh-pet's work-status.ts)
// ---------------------------------------------------------------------------

function turnEndState(kind) {
  if (kind === 'completed') return 'success';
  if (kind === 'error' || kind === 'max-tokens' || kind === 'timeout') return 'error';
  return null; // aborted / blocked / unknown -> clear entry back to idle
}

function goalUpdateAction(args) {
  try {
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;
    if (parsed && (parsed.action === 'complete' || parsed.action === 'blocked')) {
      return parsed.action;
    }
  } catch {
    // not JSON — ignore
  }
  return null;
}

function currentTaskFromTodo(event) {
  const todos = event?.data?.todos;
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const inProgress = todos.filter((t) => t && t.status === 'in_progress');
  const target = inProgress.length > 0 ? inProgress[inProgress.length - 1] : todos.find((t) => t && t.status === 'pending');
  if (!target || typeof target.content !== 'string') return null;
  const text = target.content.trim();
  if (!text) return null;
  if ([...text].length > TASK_TEXT_MAX) {
    return [...text].slice(0, TASK_TEXT_MAX).join('') + '…';
  }
  return text;
}

function completedState(turn) {
  if (!turn.goalRound) return 'success';
  if (turn.closing === 'blocked') return 'error';
  if (turn.closing === 'complete') return 'success';
  return 'result'; // middle round of a goal continuation
}

function reduceWorkStatus(event, turn) {
  switch (event.type) {
    case 'turn/start':
      return 'thinking';
    case 'tool/call':
      return event?.data?.name === 'ask_user_question' ? 'waiting' : 'working';
    case 'tool/result':
      return 'result';
    case 'approval/asked':
      return 'waiting';
    case 'turn/end': {
      const base = turnEndState(event?.data?.reason?.kind);
      if (base === 'success') return completedState(turn);
      return base; // may be null -> clear entry
    }
    default:
      return null;
  }
}

export function apply(ctx) {
  // /state 命中计数：用于确认浏览器侧桌宠正在轮询（诊断端点 /health 可查）
  let stateHits = 0;

  // Per-session work status entries.
  // entry = { state, task, sessionId, seq, turn: {goalRound, closing}, tools: Map, timers }
  const entries = new Map();

  // 最近一次有事件到达的会话（条目被终态清理后，仍用它读出累计用量，
  // 否则空闲期双击螃蟹会显示"暂无用量"）
  let lastSessionId = null;

  // —— 会话 token 用量累计（来自 assistant/message 事件的 usage 字段）——
  // 同一条 assistant 消息（turn:step 相同）只计一次，避免流式重复计数。
  // 累计结果持久化到 DSH_HOME/dsh-clawd/usage.json：插件重载或 DSH 重启后，
  // "会话"仍显示这个会话从开始到现在的总额（而不是本次运行产生的费用）。
  const usageDir = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-clawd');
  const usageFile = path.join(usageDir, 'usage.json');
  const usageBySession = new Map(); // sessionId -> { input, output, cacheRead, cacheWrite, reasoning, seen:Set, at }
  let usageSaveTimer = null;
  const saveUsageNow = () => {
    try {
      const sessions = {};
      const list = [...usageBySession.entries()]
        .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
        .slice(0, 30);
      for (const [sid, u] of list) {
        sessions[sid] = {
          input: u.input,
          output: u.output,
          cacheRead: u.cacheRead,
          cacheWrite: u.cacheWrite,
          reasoning: u.reasoning,
          at: u.at ?? 0,
        };
      }
      fs.mkdirSync(usageDir, { recursive: true });
      fs.writeFileSync(usageFile, JSON.stringify({ version: 1, sessions }));
    } catch (err) {
      ctx.logger?.warn?.('[dsh-clawd] save usage failed:', err);
    }
  };
  const scheduleUsageSave = () => {
    if (usageSaveTimer) return;
    usageSaveTimer = setTimeout(() => {
      usageSaveTimer = null;
      saveUsageNow();
    }, 1500);
  };

  // 启动时加载历史累计（文件损坏 / 首次运行则从零开始）
  try {
    const raw = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
    const loadNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    for (const [sid, u] of Object.entries(raw?.sessions ?? {})) {
      if (!u || typeof u !== 'object') continue;
      usageBySession.set(String(sid), {
        input: loadNum(u.input),
        output: loadNum(u.output),
        cacheRead: loadNum(u.cacheRead),
        cacheWrite: loadNum(u.cacheWrite),
        reasoning: loadNum(u.reasoning),
        seen: new Set(),
        at: loadNum(u.at),
      });
    }
  } catch {
    /* 首次运行 / 文件损坏：从零开始 */
  }

  // 没有任何事件时（刚重启），也能显示最近一个会话的累计用量
  if (!lastSessionId && usageBySession.size > 0) {
    let bestSid = null;
    let bestAt = -1;
    for (const [sid, u] of usageBySession) {
      if ((u.at ?? 0) > bestAt) {
        bestAt = u.at ?? 0;
        bestSid = sid;
      }
    }
    lastSessionId = bestSid;
  }
  const usageOf = (sessionId) => {
    const u = usageBySession.get(sessionId);
    if (!u) return null;
    return {
      input: u.input,
      output: u.output,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
      reasoning: u.reasoning,
    };
  };
  const addUsage = (sessionId, event) => {
    const usage = event?.data?.usage;
    if (!usage || typeof usage !== 'object') return;
    const key = String(event?.data?.turn ?? '') + ':' + String(event?.data?.step ?? '');
    let u = usageBySession.get(sessionId);
    if (!u) {
      u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, seen: new Set(), at: Date.now() };
      usageBySession.set(sessionId, u);
    }
    if (u.seen.has(key)) return;
    u.seen.add(key);
    if (u.seen.size > 500) {
      const first = u.seen.values().next().value;
      if (first !== undefined) u.seen.delete(first);
    }
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    u.input += num(usage.inputTokens);
    u.output += num(usage.outputTokens);
    u.cacheRead += num(usage.cacheReadTokens);
    u.cacheWrite += num(usage.cacheWriteTokens);
    u.reasoning += num(usage.reasoningTokens);
    u.at = Date.now();
    scheduleUsageSave();
  };

  // —— 当前默认模型名缓存（客户端按模型折算会话费用，60s 刷新）——
  let modelCache = { at: 0, value: null };
  const currentModel = () => {
    if (modelCache.at && Date.now() - modelCache.at < 60000) return modelCache.value;
    try {
      const sel = ctx.get?.('agentDefaultModel')?.currentSelection?.();
      modelCache = { at: Date.now(), value: sel?.model ?? null };
    } catch {
      modelCache = { at: Date.now(), value: null };
    }
    return modelCache.value;
  };

  // —— DeepSeek 账户余额缓存（deepseekAccount 是可选服务，缺失时优雅降级）——
  // /state 只读缓存；缓存超过 10s 时在后台异步刷新一次（不阻塞轮询），
  // 另有 30s 定时刷新兜底。上次的余额快照落盘，重启后立刻显示旧值、
  // 随后被后台刷新覆盖 —— "余额获取有点慢"的体感修复。
  const balanceFile = path.join(usageDir, 'balance.json');
  let balanceCache = { at: 0, value: null }; // value = { account, links, balance }
  try {
    const raw = JSON.parse(fs.readFileSync(balanceFile, 'utf8'));
    if (raw && typeof raw === 'object' && raw.value) {
      balanceCache = { at: Number(raw.at) || 0, value: raw.value };
    }
  } catch {
    /* 首次运行：无缓存 */
  }
  const saveBalanceNow = () => {
    try {
      fs.mkdirSync(usageDir, { recursive: true });
      fs.writeFileSync(balanceFile, JSON.stringify({ at: balanceCache.at, value: balanceCache.value }));
    } catch {
      /* 落盘失败不影响功能 */
    }
  };
  let refreshing = false;
  const refreshBalance = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const acct = ctx.get?.('deepseekAccount');
      if (!acct || typeof acct.getState !== 'function') {
        balanceCache = { at: Date.now(), value: { account: 'unavailable', links: null, balance: null } };
        saveBalanceNow();
        return;
      }
      const view = await acct.getState();
      const account = view?.status === 'credential-stored' ? 'credential-stored' : 'signed-out';
      const links = view?.links ?? null;
      let balance = null;
      if (account === 'credential-stored' && typeof acct.getBalance === 'function') {
        const client = {
          version: 'dsh-clawd/0.1.0',
          locale: 'zh-CN',
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        };
        const result = await acct.getBalance(client);
        if (result) {
          balance =
            result.status === 'ready'
              ? { status: 'ready', wallets: result.value ?? [], bonusWallets: result.bonusWallets ?? [] }
              : { status: 'failed', wallets: [], bonusWallets: [] };
        }
      }
      balanceCache = { at: Date.now(), value: { account, links, balance } };
      saveBalanceNow();
    } catch (err) {
      ctx.logger?.warn?.('[dsh-clawd] balance refresh failed:', err);
      balanceCache = {
        at: Date.now(),
        value: balanceCache.value ?? { account: 'unavailable', links: null, balance: null },
      };
    } finally {
      refreshing = false;
    }
  };

  const snapshot = () => {
    const e = pickDisplayed();
    const sid = e?.sessionId ?? lastSessionId;
    const b = balanceCache.value;
    return {
      state: e?.state ?? null,
      task: e?.task ?? null,
      sessionId: sid ?? null,
      usage: sid ? usageOf(sid) : null,
      model: currentModel(),
      account: b?.account ?? 'unavailable',
      links: b?.links ?? null,
      balance: b?.balance ?? null,
      ts: Date.now(),
    };
  };

  function pickDisplayed() {
    let best = null;
    for (const e of entries.values()) {
      if (!best) {
        best = e;
        continue;
      }
      const a = WORK_STATUS_PRIORITY[e.state] ?? 0;
      const b = WORK_STATUS_PRIORITY[best.state] ?? 0;
      if (a > b || (a === b && e.seq > best.seq)) best = e;
    }
    return best ?? null;
  }

  const clearEntry = (sessionId) => {
    const e = entries.get(sessionId);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    entries.delete(sessionId);
  };

  const scheduleTerminalClear = (sessionId, entry) => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const cur = entries.get(sessionId);
      if (cur && cur.seq === entry.seq) entries.delete(sessionId);
    }, TERMINAL_CLEAR_MS);
  };

  const setState = (sessionId, state, task, turn) => {
    let e = entries.get(sessionId);
    if (!e) {
      e = { sessionId, seq: 0, state: null, task: null, turn, tools: new Map() };
      entries.set(sessionId, e);
    }
    e.seq += 1;
    e.state = state;
    if (task !== undefined) e.task = task;
    if (state === 'success' || state === 'error') scheduleTerminalClear(sessionId, e);
    else if (e.timer) {
      clearTimeout(e.timer);
      e.timer = null;
    }
    return e;
  };

  // HTTP route --------------------------------------------------------------
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_SEGMENT,
        handler: async (req, res) => {
          try {
            // 访问策略：只服务本机/同源请求。浏览器里打开的任意网页（跨站）无法读取本地状态，
            // 也挡住 DNS rebinding（Host 必须是 localhost/127.0.0.1/[::1]）。
            const host = String(req.headers.host ?? '');
            const origin = String(req.headers.origin ?? '');
            const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host);
            const localOrigin = !origin || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin);
            if (!localHost || !localOrigin) {
              res.statusCode = 403;
              res.end('forbidden');
              return;
            }
            const rawUrl = req.url || '/';
            const u = new URL(rawUrl, 'http://localhost');
            const rest = decodeURIComponent(u.pathname.slice(ROUTE_SEGMENT.length + 1));
            if (rest === 'state' || rest === 'state/') {
              stateHits += 1;
              // 缓存超 10s 就在后台补一次刷新（不等它，先回旧值，下次轮询拿新值）
              if (Date.now() - balanceCache.at > 10000) refreshBalance().catch(() => {});
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              res.end(JSON.stringify(snapshot()));
              return;
            }
            if (rest === 'health' || rest === 'health/') {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true, stateHits }));
              return;
            }
            res.statusCode = 404;
            res.end('not found');
          } catch (err) {
            if (!res.destroyed && !res.writableEnded) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'text/plain; charset=utf-8');
              res.end('internal error');
            }
            ctx.logger?.warn?.('[dsh-clawd] route error:', err);
          }
        },
      }),
    'dsh-clawd: 状态路由',
  );

  // Balance refresh loop (30s) --------------------------------------------------
  ctx.effect(() => {
    refreshBalance();
    const timer = setInterval(() => {
      refreshBalance().catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, 'dsh-clawd: 余额缓存');

  // 落盘：插件卸载/重载前把累计用量与余额快照写回磁盘 ----------------------------
  ctx.effect(
    () => () => {
      if (usageSaveTimer) {
        clearTimeout(usageSaveTimer);
        usageSaveTimer = null;
      }
      saveUsageNow();
      saveBalanceNow();
    },
    'dsh-clawd: 用量落盘',
  );

  // Session event folding -----------------------------------------------------
  ctx.effect(() => {
    const dispose = ctx.on('session/event', (session, event) => {
      if (!event || typeof event.type !== 'string') return;
      const sessionId = String(session?.header?.id ?? session?.id ?? 'unknown');
      lastSessionId = sessionId;
      let e = entries.get(sessionId);

      switch (event.type) {
        case 'turn/start': {
          if (e) e.turn = { goalRound: false, closing: null };
          setState(sessionId, 'thinking', null, { goalRound: false, closing: null });
          return;
        }
        case 'assistant/message': {
          addUsage(sessionId, event); // 累计 token 用量（双击螃蟹查看）
          return;
        }
        case 'user/message': {
          if (event?.data?.source?.kind === 'goal') {
            if (!e) e = entries.get(sessionId);
            if (e) e.turn.goalRound = true;
          }
          return;
        }
        case 'todo/write': {
          if (!e || e.tools.size > 0) return; // don't clobber bubble while tools in flight
          const task = currentTaskFromTodo(event);
          if (task) {
            e.seq += 1;
            e.task = task;
          }
          return;
        }
        case 'tool/call': {
          if (!e) e = setState(sessionId, 'working', undefined, { goalRound: false, closing: null });
          const name = event?.data?.name;
          if (name === 'update_goal') {
            const closing = goalUpdateAction(event?.data?.arguments);
            if (closing) e.turn.closing = closing;
          }
          const callId = event?.data?.callId;
          const key = callId != null ? callId : Symbol('anon');
          e.tools.set(key, true);
          setState(sessionId, name === 'ask_user_question' ? 'waiting' : 'working', undefined, e.turn);
          return;
        }
        case 'tool/result': {
          if (!e) return;
          const callId = event?.data?.message?.source?.callId;
          if (callId != null) {
            e.tools.delete(callId);
          } else if (e.tools.size > 0) {
            // anonymous result: release one in-flight call
            for (const k of e.tools.keys()) {
              if (typeof k === 'symbol') {
                e.tools.delete(k);
                break;
              }
            }
          }
          if (e.tools.size > 0) {
            setState(sessionId, 'working', undefined, e.turn); // more calls in flight
          } else {
            setState(sessionId, 'result', undefined, e.turn);
          }
          return;
        }
        case 'approval/asked': {
          setState(sessionId, 'waiting', undefined, e?.turn ?? { goalRound: false, closing: null });
          return;
        }
        case 'turn/end': {
          if (!e) return;
          const state = reduceWorkStatus(event, e.turn);
          if (state == null) {
            clearEntry(sessionId);
          } else {
            setState(sessionId, state, undefined, e.turn);
          }
          return;
        }
        default:
          return;
      }
    });
    return () => dispose();
  }, 'dsh-clawd: 会话事件折叠');
}
