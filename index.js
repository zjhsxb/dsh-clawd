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
  // 单个字段的异常值防护：负数 / NaN / Infinity → 0；超过 1e9（数据损坏标志）→ 0
  const num = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
    return v > 1e9 ? 0 : v;
  };

  // 原子写入：先写 .tmp 再 rename，避免进程中断留下半个 JSON。
  // 读取：损坏 / 形状不对的文件复制一份 .bak-<ts> 留档后从零开始。
  const writeJsonAtomic = (file, data) => {
    fs.mkdirSync(usageDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  };
  const readJsonSafe = (file) => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object') throw new Error('bad shape');
      return raw;
    } catch {
      try {
        fs.copyFileSync(file, file + '.bak-' + Date.now());
      } catch {
        /* 无文件可备份（首次运行） */
      }
      return null;
    }
  };

  // sessionId -> { input, output, cacheRead, cacheWrite, reasoning,
  //                lastByKey: Map, lastTurn, lastStep, at }
  // 去重语义（对齐 DSH token-meter 的 addReplacing）：同一个 turn:step 的 usage
  // 是"替换"而非"追加"——保留该 key 的最新值，重复上报时先减旧值再加新值。
  // lastByKey 容量 500，超出丢最旧；跨重启用 lastTurn/lastStep 水位线跳过回放事件。
  const usageBySession = new Map();
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
          lastTurn: u.lastTurn ?? 0,
          lastStep: u.lastStep ?? 0,
          at: u.at ?? 0,
          // v2：模型 × 空闲/高峰 分段累计（客户端逐段计价，不用当前模型/时段统算历史）
          segments: [...u.segments.entries()].map(([model, s]) => ({
            model,
            idle: { input: s.idle.input, output: s.idle.output, cacheRead: s.idle.cacheRead, cacheWrite: s.idle.cacheWrite },
            peak: { input: s.peak.input, output: s.peak.output, cacheRead: s.peak.cacheRead, cacheWrite: s.peak.cacheWrite },
          })),
        };
      }
      writeJsonAtomic(usageFile, { version: 2, sessions });
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

  // 启动时加载历史累计（损坏留档 .bak-<ts>，首次运行从零开始）
  // v1：无 segments（客户端回退整段估算）；v2：带 segments 分段累计。
  const loaded = readJsonSafe(usageFile);
  if ((loaded?.version === 1 || loaded?.version === 2) && loaded.sessions) {
    for (const [sid, u] of Object.entries(loaded.sessions)) {
      if (!u || typeof u !== 'object') continue;
      const segments = new Map();
      if (Array.isArray(u.segments)) {
        for (const s of u.segments) {
          if (!s || typeof s.model !== 'string') continue;
          const bucket = (b) => ({
            input: num(b?.input),
            output: num(b?.output),
            cacheRead: num(b?.cacheRead),
            cacheWrite: num(b?.cacheWrite),
          });
          segments.set(s.model, { idle: bucket(s.idle), peak: bucket(s.peak) });
        }
      }
      usageBySession.set(String(sid), {
        input: num(u.input),
        output: num(u.output),
        cacheRead: num(u.cacheRead),
        cacheWrite: num(u.cacheWrite),
        reasoning: num(u.reasoning),
        lastByKey: new Map(),
        lastTurn: num(u.lastTurn),
        lastStep: num(u.lastStep),
        at: typeof u.at === 'number' && Number.isFinite(u.at) && u.at >= 0 ? u.at : 0,
        segments,
      });
    }
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
  const segmentsOf = (sessionId) => {
    const u = usageBySession.get(sessionId);
    if (!u || u.segments.size === 0) return null;
    return [...u.segments.entries()].map(([model, s]) => ({
      model,
      idle: { input: s.idle.input, output: s.idle.output, cacheRead: s.idle.cacheRead, cacheWrite: s.idle.cacheWrite },
      peak: { input: s.peak.input, output: s.peak.output, cacheRead: s.peak.cacheRead, cacheWrite: s.peak.cacheWrite },
    }));
  };
  // 高峰时段判定（与 client.js @pricing-block 的 isPeakNow 保持同一规则，供分段累计用）：
  // 北京时间周一至周五 9:00-12:00 / 14:00-18:00（不判法定节假日，仅估算）。
  const isPeakAt = (ts) => {
    const bj = new Date(ts + 480 * 60000);
    const day = bj.getUTCDay();
    const h = bj.getUTCHours();
    if (day === 0 || day === 6) return false;
    return (h >= 9 && h < 12) || (h >= 14 && h < 18);
  };
  // 分段累计：把本次事件的增量计入 (模型 × 空闲/高峰) 桶。模型取事件时刻的默认模型
  // （60s 缓存，用户中途换模型时自然开新段）；每会话模型数上限 16，超出只计总额不计分段。
  const addToSegment = (u, model, peak, dInput, dOutput, dCacheRead, dCacheWrite) => {
    if (!dInput && !dOutput && !dCacheRead && !dCacheWrite) return;
    let seg = u.segments.get(model);
    if (!seg) {
      if (u.segments.size >= 16) return;
      seg = {
        idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
      u.segments.set(model, seg);
    }
    const bucket = peak ? seg.peak : seg.idle;
    bucket.input = Math.max(0, bucket.input + dInput);
    bucket.output = Math.max(0, bucket.output + dOutput);
    bucket.cacheRead = Math.max(0, bucket.cacheRead + dCacheRead);
    bucket.cacheWrite = Math.max(0, bucket.cacheWrite + dCacheWrite);
  };
  const addUsage = (sessionId, event) => {
    const usage = event?.data?.usage;
    if (!usage || typeof usage !== 'object') return;
    const turn = event?.data?.turn;
    const step = event?.data?.step;
    const next = {
      input: num(usage.inputTokens),
      output: num(usage.outputTokens),
      cacheRead: num(usage.cacheReadTokens),
      cacheWrite: num(usage.cacheWriteTokens),
      reasoning: num(usage.reasoningTokens),
    };
    let u = usageBySession.get(sessionId);
    if (!u) {
      u = {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        lastByKey: new Map(), lastTurn: 0, lastStep: 0, at: Date.now(), segments: new Map(),
      };
      usageBySession.set(sessionId, u);
    }
    // 去重 key：优先 turn:step；缺 turn/step 用消息 id；再缺（非正常路径）用 usage 指纹——
    // 指纹相同的重复事件按"替换"只计一次、指纹不同各自累计（跨重启回放同样安全，不会
    // 像固定占位 key 那样把所有无 id 事件塌缩成一条导致大量漏计）。
    const msgId = event?.data?.message?.id;
    const key =
      turn != null && step != null
        ? String(turn) + ':' + String(step)
        : msgId != null
          ? 'msg:' + String(msgId)
          : 'fp:' + [next.input, next.output, next.cacheRead, next.cacheWrite, next.reasoning].join('|');
    // 跨重启水位线：重放历史事件时，早于水位线且本运行没记过的 key 一律跳过。
    // 本运行已记过的 key（lastByKey 命中）不受水位线限制——同 key 再来是"替换"。
    if (turn != null && step != null) {
      const isBefore = turn < u.lastTurn || (turn === u.lastTurn && step <= u.lastStep);
      if (isBefore && !u.lastByKey.has(key)) return;
      if (turn > u.lastTurn || (turn === u.lastTurn && step > u.lastStep)) {
        u.lastTurn = turn;
        u.lastStep = step;
      }
    }
    const prev = u.lastByKey.get(key);
    // 替换语义：该 key 已有旧值，先减旧值再加新值（并把该 key 更新为最新值）
    const dInput = next.input - (prev ? prev.input : 0);
    const dOutput = next.output - (prev ? prev.output : 0);
    const dCacheRead = next.cacheRead - (prev ? prev.cacheRead : 0);
    const dCacheWrite = next.cacheWrite - (prev ? prev.cacheWrite : 0);
    u.input += dInput;
    u.output += dOutput;
    u.cacheRead += dCacheRead;
    u.cacheWrite += dCacheWrite;
    u.reasoning += next.reasoning - (prev ? prev.reasoning : 0);
    u.lastByKey.set(key, next);
    if (u.lastByKey.size > 500) {
      const first = u.lastByKey.keys().next().value;
      if (first !== undefined) u.lastByKey.delete(first);
    }
    addToSegment(u, currentModel() ?? 'unknown', isPeakAt(Date.now()), dInput, dOutput, dCacheRead, dCacheWrite);
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
  const loadedBalance = readJsonSafe(balanceFile);
  if (loadedBalance?.version === 1 && loadedBalance.value && typeof loadedBalance.value === 'object') {
    balanceCache = { at: Number(loadedBalance.at) || 0, value: loadedBalance.value };
  }
  const saveBalanceNow = () => {
    try {
      writeJsonAtomic(balanceFile, { version: 1, at: balanceCache.at, value: balanceCache.value });
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
          version: 'dsh-clawd/0.1.2',
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
      segments: sid ? segmentsOf(sid) : null,
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
    e.at = Date.now();
    if (task !== undefined) e.task = task;
    if (state === 'success' || state === 'error') scheduleTerminalClear(sessionId, e);
    else if (e.timer) {
      clearTimeout(e.timer);
      e.timer = null;
    }
    return e;
  };

  // 状态机看门狗：会话卡死（turn/end 丢失、agent 进程异常）时自动清条目回空闲，
  // 避免宠物永久卡在一个表情。按状态给不同阈值：
  //   thinking 15 分钟——流式输出期间的 assistant/message 会不断续命，这里只兜底真卡死；
  //   working 30 分钟——单个长工具（构建/下载）可能跑很久，不能 5 分钟就清；
  //   result 5 分钟——tool/result 之后 turn/end 应当秒级到达，5 分钟无动静即卡死。
  // waiting（问用户/等审批）**绝不被看门狗清除**——用户可能离开很久，等待状态本身是真实的，
  // 由后续的用户回答/approval 事件或 turn/end 自然推进。
  // success/error 有自己的 8s 终态清除（TERMINAL_CLEAR_MS），不受看门狗影响。
  const STALL_CLEAR_MS = { thinking: 15 * 60 * 1000, working: 30 * 60 * 1000, result: 5 * 60 * 1000 };
  const sweepStalledEntries = () => {
    const now = Date.now();
    for (const [sid, e] of entries) {
      if (!e.state) continue;
      const limit = STALL_CLEAR_MS[e.state];
      if (!limit) continue; // waiting / success / error：不参与看门狗
      if (now - (e.at ?? 0) > limit) clearEntry(sid);
    }
  };

  // HTTP route --------------------------------------------------------------
  // 速率限制：滑动窗口，60s 最多 120 次（客户端 1.5s 轮询 = 40 次/min，余量充足）。
  // 目的：任何本地恶意页/脚本即便拿到同源访问，也无法高频拖拽状态。
  const RATE_WINDOW_MS = 60000;
  const RATE_MAX = 120;
  let rateWindowStart = 0;
  let rateCount = 0;
  const rateLimited = () => {
    const now = Date.now();
    if (now - rateWindowStart >= RATE_WINDOW_MS) {
      rateWindowStart = now;
      rateCount = 0;
    }
    rateCount += 1;
    return rateCount > RATE_MAX;
  };
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_SEGMENT,
        handler: async (req, res) => {
          try {
            // 只接受只读方法：POST/PUT/DELETE 等一律 405（本路由没有任何写接口）
            const method = String(req.method ?? 'GET').toUpperCase();
            if (method !== 'GET' && method !== 'HEAD') {
              res.statusCode = 405;
              res.setHeader('Allow', 'GET, HEAD');
              res.end('method not allowed');
              return;
            }
            if (rateLimited()) {
              res.statusCode = 429;
              res.setHeader('Retry-After', '5');
              res.end('too many requests');
              return;
            }
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
            const sendJson = (body) => {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              if (method === 'HEAD') {
                res.setHeader('Content-Length', Buffer.byteLength(body));
                res.end();
              } else {
                res.end(body);
              }
            };
            if (rest === 'state' || rest === 'state/') {
              stateHits += 1;
              // 缓存超 10s 就在后台补一次刷新（不等它，先回旧值，下次轮询拿新值）
              if (Date.now() - balanceCache.at > 10000) refreshBalance().catch(() => {});
              sendJson(JSON.stringify(snapshot()));
              return;
            }
            if (rest === 'health' || rest === 'health/') {
              sendJson(JSON.stringify({ ok: true, stateHits }));
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

  // Balance refresh loop (30s) + stall watchdog sweep --------------------------
  ctx.effect(() => {
    refreshBalance();
    const timer = setInterval(() => {
      refreshBalance().catch(() => {});
      sweepStalledEntries();
    }, 30000);
    return () => clearInterval(timer);
  }, 'dsh-clawd: 余额缓存与看门狗');

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
          if (e) e.at = Date.now(); // 流式输出期间续命，防长输出被看门狗误清 thinking
          return;
        }
        case 'user/message': {
          if (event?.data?.source?.kind === 'goal') {
            if (!e) e = entries.get(sessionId);
            if (e) {
              e.turn.goalRound = true;
              e.at = Date.now();
            }
          }
          return;
        }
        case 'todo/write': {
          if (!e || e.tools.size > 0) return; // don't clobber bubble while tools in flight
          const task = currentTaskFromTodo(event);
          if (task) {
            e.seq += 1;
            e.task = task;
            e.at = Date.now();
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
