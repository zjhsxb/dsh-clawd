// dsh-clawd host tests: usage accounting, persistence, and HTTP guard.
// Runs against the REAL index.js (no DSH imports needed — it only imports
// node builtins), driven through a fake cordis ctx.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';

const ROUTE = '/dsh-clawd-7788';

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-clawd-test-'));
}

// Fake cordis ctx: collects effect disposers, event listeners, and the route handler.
function makeCtx() {
  const ctx = {
    effects: [],
    listeners: new Map(),
    routes: [],
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') ctx.effects.push(dispose);
    },
    on(event, cb) {
      ctx.listeners.set(event, cb);
      return () => ctx.listeners.delete(event);
    },
    webServer: {
      register(route) {
        ctx.routes.push(route);
      },
    },
    get() {
      return undefined; // no agentDefaultModel / deepseekAccount in tests
    },
    logger: { warn() {} },
  };
  return ctx;
}

function dispose(ctx) {
  for (const d of ctx.splice ? ctx.effects.splice(0) : ctx.effects.reverse()) d();
  ctx.effects = [];
}

function emit(ctx, sessionId, type, data) {
  const cb = ctx.listeners.get('session/event');
  assert.ok(cb, 'session/event listener registered');
  cb({ header: { id: sessionId } }, { type, data });
}

function usageEvent(turn, step, usage) {
  return { turn, step, usage };
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(s) {
      if (s !== undefined) this.body += String(s);
    },
  };
}

async function getState(ctx, method = 'GET', headers = {}) {
  const handler = ctx.routes[0].handler;
  const req = {
    method,
    url: ROUTE + '/state',
    headers: { host: '127.0.0.1:3695', ...headers },
  };
  const res = fakeRes();
  await handler(req, res);
  return res;
}

test('usage accumulates per turn:step and sessions are isolated', async () => {
  process.env.DSH_HOME = tempHome();
  const ctx = makeCtx();
  apply(ctx);
  emit(ctx, 's1', 'assistant/message', usageEvent(3, 1, { inputTokens: 100, outputTokens: 50 }));
  emit(ctx, 's1', 'assistant/message', usageEvent(3, 2, { inputTokens: 200, outputTokens: 80 }));
  emit(ctx, 's2', 'assistant/message', usageEvent(1, 1, { inputTokens: 999, outputTokens: 1 }));

  // last event's session (s2) is what /state reports
  let res = await getState(ctx);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).usage.input, 999);

  // but the persisted file keeps both sessions separate
  dispose(ctx); // flushes usage.json
  const file = path.join(process.env.DSH_HOME, 'dsh-clawd', 'usage.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.sessions.s1.input, 300);
  assert.equal(saved.sessions.s1.output, 130);
  assert.equal(saved.sessions.s2.input, 999);
  assert.equal(saved.sessions.s2.output, 1);
});

test('same turn:step REPLACES its usage instead of appending (DSH token-meter semantics)', async () => {
  process.env.DSH_HOME = tempHome();
  const ctx = makeCtx();
  apply(ctx);
  emit(ctx, 's1', 'assistant/message', usageEvent(5, 1, { inputTokens: 100, outputTokens: 50 }));
  emit(ctx, 's1', 'assistant/message', usageEvent(5, 1, { inputTokens: 300, outputTokens: 80 }));
  emit(ctx, 's1', 'assistant/message', usageEvent(5, 2, { inputTokens: 10, outputTokens: 5 }));

  const res = await getState(ctx);
  const u = JSON.parse(res.body).usage;
  assert.equal(u.input, 310); // 300 (replaced) + 10 — not 410
  assert.equal(u.output, 85);
  dispose(ctx);
});

test('restart replay (turn:step <= watermark) is skipped, new steps are counted', async () => {
  const home = tempHome();
  process.env.DSH_HOME = home;

  // run 1
  const ctx1 = makeCtx();
  apply(ctx1);
  emit(ctx1, 's1', 'assistant/message', usageEvent(3, 1, { inputTokens: 100 }));
  emit(ctx1, 's1', 'assistant/message', usageEvent(3, 2, { inputTokens: 200 }));
  dispose(ctx1); // persist with watermark 3:2

  // run 2: same home dir → loads watermark; replay same events, then a new one
  const ctx2 = makeCtx();
  apply(ctx2);
  emit(ctx2, 's1', 'assistant/message', usageEvent(3, 1, { inputTokens: 100 }));
  emit(ctx2, 's1', 'assistant/message', usageEvent(3, 2, { inputTokens: 200 }));
  emit(ctx2, 's1', 'assistant/message', usageEvent(4, 1, { inputTokens: 7 }));

  const res = await getState(ctx2);
  const u = JSON.parse(res.body).usage;
  assert.equal(u.input, 307); // 300 replayed (skipped) + 7 new
  dispose(ctx2);
});

test('abnormal usage values are ignored (negative / NaN / huge / wrong type)', async () => {
  process.env.DSH_HOME = tempHome();
  const ctx = makeCtx();
  apply(ctx);
  emit(ctx, 's1', 'assistant/message', usageEvent(1, 1, {
    inputTokens: -5,
    outputTokens: NaN,
    cacheReadTokens: 2e9, // > 1e9 cap → 0
    cacheWriteTokens: 'x',
    reasoningTokens: 7,
  }));
  emit(ctx, 's1', 'assistant/message', usageEvent(1, 2, {})); // no usage → ignored
  const res = await getState(ctx);
  const u = JSON.parse(res.body).usage;
  assert.equal(u.input, 0);
  assert.equal(u.output, 0);
  assert.equal(u.cacheRead, 0);
  assert.equal(u.cacheWrite, 0);
  assert.equal(u.reasoning, 7);
  dispose(ctx);
});

test('corrupt usage.json is backed up to .bak-* and starts fresh', async () => {
  const home = tempHome();
  process.env.DSH_HOME = home;
  const dir = path.join(home, 'dsh-clawd');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'usage.json'), '{corrupt!!');

  const ctx = makeCtx();
  apply(ctx);
  const res = await getState(ctx);
  assert.equal(JSON.parse(res.body).usage, null); // nothing loaded

  const baks = fs.readdirSync(dir).filter((f) => f.startsWith('usage.json.bak-'));
  assert.equal(baks.length, 1, 'corrupt file backed up once');
  dispose(ctx);
});

test('HTTP: only localhost host/origin; 405 for non-GET/HEAD; 429 rate limit; HEAD has no body', async () => {
  process.env.DSH_HOME = tempHome();
  const ctx = makeCtx();
  apply(ctx);
  const handler = ctx.routes[0].handler;

  // evil host → 403
  let res = fakeRes();
  await handler({ method: 'GET', url: ROUTE + '/state', headers: { host: 'attacker.example.com' } }, res);
  assert.equal(res.statusCode, 403);

  // evil origin → 403
  res = fakeRes();
  await handler({ method: 'GET', url: ROUTE + '/state', headers: { host: '127.0.0.1:3695', origin: 'https://evil.example.com' } }, res);
  assert.equal(res.statusCode, 403);

  // POST → 405 with Allow
  res = fakeRes();
  await handler({ method: 'POST', url: ROUTE + '/state', headers: { host: '127.0.0.1:3695' } }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET, HEAD');

  // HEAD → 200, Content-Length set, empty body
  res = fakeRes();
  await handler({ method: 'HEAD', url: ROUTE + '/state', headers: { host: '127.0.0.1:3695' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(Number(res.headers['Content-Length']) > 0);
  assert.equal(res.body, '');

  // rate limit: 120 allowed per minute, the 121st gets 429
  let limited = null;
  for (let i = 0; i < 121; i++) {
    const r = fakeRes();
    await handler({ method: 'GET', url: ROUTE + '/health', headers: { host: '127.0.0.1:3695' } }, r);
    if (r.statusCode === 429) {
      limited = r;
      break;
    }
  }
  assert.ok(limited, '429 returned after burst');
  assert.equal(limited.headers['Retry-After'], '5');
  dispose(ctx);
});

test('unknown path → 404', async () => {
  process.env.DSH_HOME = tempHome();
  const ctx = makeCtx();
  apply(ctx);
  const res = fakeRes();
  await ctx.routes[0].handler({ method: 'GET', url: ROUTE + '/nope', headers: { host: '127.0.0.1:3695' } }, res);
  assert.equal(res.statusCode, 404);
  dispose(ctx);
});

// ---------------------------------------------------------------------------
// 0.1.2: dedup without turn/step/message.id (fingerprint keys)
// ---------------------------------------------------------------------------

test('dedup: events WITHOUT turn/step/message.id — identical usage collapses, different usage accumulates', async () => {
  process.env.DSH_HOME = tempHome();
  const ctx = makeCtx();
  apply(ctx);
  const noIds = (usage) => ({ usage }); // no turn, no step, no message.id
  emit(ctx, 's1', 'assistant/message', noIds({ inputTokens: 100, outputTokens: 50 }));
  emit(ctx, 's1', 'assistant/message', noIds({ inputTokens: 100, outputTokens: 50 })); // duplicate → replaced
  emit(ctx, 's1', 'assistant/message', noIds({ inputTokens: 20, outputTokens: 5 })); // different → added

  const res = await getState(ctx);
  const u = JSON.parse(res.body).usage;
  assert.equal(u.input, 120); // 100 + 20 — not 220, not 20 (old 'msg:x' bug collapsed ALL to one key)
  assert.equal(u.output, 55);
  dispose(ctx);
});

test('dedup: message.id key used when turn/step missing', async () => {
  process.env.DSH_HOME = tempHome();
  const ctx = makeCtx();
  apply(ctx);
  const withId = (id, usage) => ({ message: { id }, usage });
  emit(ctx, 's1', 'assistant/message', withId('m1', { inputTokens: 100 }));
  emit(ctx, 's1', 'assistant/message', withId('m1', { inputTokens: 300 })); // same id → replace
  emit(ctx, 's1', 'assistant/message', withId('m2', { inputTokens: 10 })); // new id → add

  const res = await getState(ctx);
  assert.equal(JSON.parse(res.body).usage.input, 310);
  dispose(ctx);
});

// ---------------------------------------------------------------------------
// 0.1.2: usage segmented by (model × idle/peak) so the client prices history
// per actual model + period instead of current model + current period
// ---------------------------------------------------------------------------

test('segments: model split across restarts is kept; idle+peak sums equal totals', async () => {
  const home = tempHome();
  process.env.DSH_HOME = home;

  // run 1: model = deepseek-flash
  let ctx = makeCtx();
  let model = 'deepseek-flash';
  ctx.get = (name) => (name === 'agentDefaultModel' ? { currentSelection: () => ({ model }) } : undefined);
  apply(ctx);
  emit(ctx, 's1', 'assistant/message', usageEvent(1, 1, { inputTokens: 100, outputTokens: 10 }));
  dispose(ctx); // flush usage.json v2

  // run 2: model = deepseek-v4-pro (60s model cache in run 1 can't be beaten
  // by a mid-run switch, so the realistic split is across restarts)
  ctx = makeCtx();
  model = 'deepseek-v4-pro';
  ctx.get = (name) => (name === 'agentDefaultModel' ? { currentSelection: () => ({ model }) } : undefined);
  apply(ctx);
  emit(ctx, 's1', 'assistant/message', usageEvent(2, 1, { inputTokens: 200, outputTokens: 20 }));

  const body = JSON.parse((await getState(ctx)).body);
  assert.equal(body.usage.input, 300);
  const segs = body.segments;
  assert.ok(Array.isArray(segs) && segs.length === 2, 'two model segments');
  const byModel = Object.fromEntries(segs.map((s) => [s.model, s]));
  const tot = (s) => s.idle.input + s.peak.input;
  assert.equal(tot(byModel['deepseek-flash']), 100);
  assert.equal(tot(byModel['deepseek-v4-pro']), 200);
  // idle/peak buckets across segments must reconcile with the overall totals
  assert.equal(
    segs.reduce((n, s) => n + s.idle.input + s.peak.input, 0),
    body.usage.input,
  );
  dispose(ctx);

  const file = path.join(home, 'dsh-clawd', 'usage.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 2);
  assert.ok(Array.isArray(saved.sessions.s1.segments));
  assert.equal(saved.sessions.s1.segments.length, 2);
});

test('segments: usage.json v1 (no segments) loads totals and reports segments=null (client falls back)', async () => {
  const home = tempHome();
  process.env.DSH_HOME = home;
  const dir = path.join(home, 'dsh-clawd');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'usage.json'),
    JSON.stringify({
      version: 1,
      sessions: {
        s1: { input: 42, output: 7, cacheRead: 0, cacheWrite: 0, reasoning: 0, lastTurn: 2, lastStep: 3, at: 1700000000000 },
      },
    }),
  );

  const ctx = makeCtx();
  apply(ctx);
  const body = JSON.parse((await getState(ctx)).body);
  assert.equal(body.usage.input, 42);
  assert.equal(body.segments, null); // v1 → no segments → client uses fallback estimate
  dispose(ctx);

  // flushed file is migrated to v2
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.sessions.s1.segments, []);
});

// ---------------------------------------------------------------------------
// 0.1.2: watchdog must not clear waiting / long-running tasks
// ---------------------------------------------------------------------------

test('watchdog: waiting survives indefinitely; long stream keeps thinking alive; stuck state cleared', async () => {
  const home = tempHome();
  process.env.DSH_HOME = home;
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const ctx = makeCtx();
  try {
    apply(ctx);

    // s1 → waiting (ask_user_question): must survive 30+ minutes
    emit(ctx, 's1', 'turn/start');
    emit(ctx, 's1', 'tool/call', { name: 'ask_user_question', callId: 'c1' });
    assert.equal(JSON.parse((await getState(ctx)).body).state, 'waiting');
    mock.timers.tick(30 * 60 * 1000);
    assert.equal(JSON.parse((await getState(ctx)).body).state, 'waiting', 'waiting never watchdog-cleared');
    emit(ctx, 's1', 'turn/end', { reason: { kind: 'aborted' } }); // resolve s1 (waiting wins pickDisplayed otherwise)

    // s2 → thinking: stream chunks keep refreshing it past 15 min
    emit(ctx, 's2', 'turn/start');
    mock.timers.tick(10 * 60 * 1000);
    emit(ctx, 's2', 'assistant/message', usageEvent(9, 1, { inputTokens: 10 }));
    mock.timers.tick(10 * 60 * 1000); // age 10min < 15min → still thinking
    let res = await getState(ctx);
    assert.equal(JSON.parse(res.body).state, 'thinking');
    assert.equal(JSON.parse(res.body).sessionId, 's2');

    // silence for 16 more minutes → thinking exceeds 15min → cleared to idle
    mock.timers.tick(16 * 60 * 1000);
    res = await getState(ctx);
    assert.equal(JSON.parse(res.body).state, null, 'stuck thinking cleared by watchdog');
  } finally {
    dispose(ctx);
    mock.timers.reset();
  }
});

test('watchdog: working (long tool run) survives 10 minutes; result cleared after 5 minutes', async () => {
  const home = tempHome();
  process.env.DSH_HOME = home;
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const ctx = makeCtx();
  try {
    apply(ctx);

    // s1 → working: a single long tool call, no events for 10 min → must survive (30min limit)
    emit(ctx, 's1', 'turn/start');
    emit(ctx, 's1', 'tool/call', { name: 'run_command', callId: 'c9' });
    assert.equal(JSON.parse((await getState(ctx)).body).state, 'working');
    mock.timers.tick(10 * 60 * 1000);
    assert.equal(JSON.parse((await getState(ctx)).body).state, 'working', 'long tool run not cleared');

    // s1 result: tool/result arrives, then silence → result limit is 5 min
    emit(ctx, 's1', 'tool/result', { message: { source: { callId: 'c9' } } });
    assert.equal(JSON.parse((await getState(ctx)).body).state, 'result');
    mock.timers.tick(6 * 60 * 1000);
    assert.equal(JSON.parse((await getState(ctx)).body).state, null, 'stale result cleared after 5 min');
  } finally {
    dispose(ctx);
    mock.timers.reset();
  }
});
