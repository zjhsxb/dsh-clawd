// dsh-clawd host tests: usage accounting, persistence, and HTTP guard.
// Runs against the REAL index.js (no DSH imports needed — it only imports
// node builtins), driven through a fake cordis ctx.
import test from 'node:test';
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
  assert.equal(saved.version, 1);
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
