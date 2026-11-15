// dsh-clawd — host side
// Clawd娘: a Claude-inspired pixel crab desktop pet for DeepSeek Harness.
// Non-official fan work; "Clawd" is Anthropic's character. Not affiliated with Anthropic.
// Derivative of dsh-pet concepts (MIT, https://github.com/PC2005-cloud/dsh-pet).

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

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

  // —— 会话 token 用量累计（来自 assistant/message 事件的 usage 字段）——
  // 同一条 assistant 消息（turn:step 相同）只计一次，避免流式重复计数。
  const usageBySession = new Map(); // sessionId -> { input, output, cacheRead, cacheWrite, reasoning, seen:Set }
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
      u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, seen: new Set() };
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
  };

  // —— DeepSeek 账户余额缓存（deepseekAccount 是可选服务，缺失时优雅降级）——
  // 60s 刷新一次，/state 只读缓存，保持轮询低延迟。
  let balanceCache = { at: 0, value: null }; // value = { account, links, balance }
  const refreshBalance = async () => {
    const acct = ctx.get?.('deepseekAccount');
    if (!acct || typeof acct.getState !== 'function') {
      balanceCache = { at: Date.now(), value: { account: 'unavailable', links: null, balance: null } };
      return;
    }
    try {
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
    } catch (err) {
      ctx.logger?.warn?.('[dsh-clawd] balance refresh failed:', err);
      balanceCache = {
        at: Date.now(),
        value: balanceCache.value ?? { account: 'unavailable', links: null, balance: null },
      };
    }
  };

  const snapshot = () => {
    const e = pickDisplayed();
    const b = balanceCache.value;
    return {
      state: e?.state ?? null,
      task: e?.task ?? null,
      sessionId: e?.sessionId ?? null,
      usage: e ? usageOf(e.sessionId) : null,
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
            const rawUrl = req.url || '/';
            const u = new URL(rawUrl, 'http://localhost');
            const rest = decodeURIComponent(u.pathname.slice(ROUTE_SEGMENT.length + 1));
            if (rest === 'state' || rest === 'state/') {
              stateHits += 1;
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

  // Balance refresh loop (60s) --------------------------------------------------
  ctx.effect(() => {
    refreshBalance();
    const timer = setInterval(() => {
      refreshBalance().catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, 'dsh-clawd: 余额缓存');

  // Session event folding -----------------------------------------------------
  ctx.effect(() => {
    const dispose = ctx.on('session/event', (session, event) => {
      if (!event || typeof event.type !== 'string') return;
      const sessionId = String(session?.header?.id ?? session?.id ?? 'unknown');
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
