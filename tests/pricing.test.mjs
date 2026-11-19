// dsh-clawd pricing tests: extracts the REAL @pricing-block shipped inside
// client.js and tests it directly (same technique as scripts/preview.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client.js'),
  'utf8',
);
const m = clientSrc.match(/\/\/ @pricing-block\n([\s\S]*?)\n\s*\/\/ @pricing-end/);
assert.ok(m, '@pricing-block found in client.js');

const api = new Function(
  m[1] +
    '\nreturn { PRICE_UPDATE, PRICE_TABLE, modelFamily, isPeakNow, estimateCostFor, estimateCost, fmtMoney, costLine };',
)();

// 北京时间：本地时区 Asia/Shanghai（+8），构造 UTC 时间戳。
// 2026-11-16 是周一；2026-11-15 是周日。
const BJT = (s) => new Date(s + 'Z');

test('PRICE_UPDATE is an ISO date (price source freshness marker)', () => {
  assert.match(api.PRICE_UPDATE, /^\d{4}-\d{2}-\d{2}$/);
});

test('price table values match DeepSeek official CNY page (checked on PRICE_UPDATE)', () => {
  // 官方中文页（元/百万 tokens，空闲/高峰）：来源注释见 client.js @pricing-block
  assert.deepEqual(api.PRICE_TABLE.flash, [0.02, 0.04, 1, 2, 4, 8]);
  assert.deepEqual(api.PRICE_TABLE['v4-pro'], [0.15, 0.3, 4.5, 9, 13.5, 27]);
  // 已停用的 chat/reasoner 不再有独立价格行——它们归入 flash 族
  assert.ok(!('chat' in api.PRICE_TABLE), 'retired chat has no own price row');
  assert.ok(!('reasoner' in api.PRICE_TABLE), 'retired reasoner has no own price row');
});

test('modelFamily maps official names; unknown models map to null', () => {
  assert.equal(api.modelFamily('deepseek-flash'), 'flash');
  assert.equal(api.modelFamily('DeepSeek-V4.1-Flash-1017'), 'flash');
  assert.equal(api.modelFamily('deepseek-v4-pro'), 'v4-pro');
  assert.equal(api.modelFamily('gpt-4o'), null);
  assert.equal(api.modelFamily(''), null);
  assert.equal(api.modelFamily(null), null);
  assert.equal(api.modelFamily(123), null);
});

test('modelFamily: retired / offline names resolve to flash family', () => {
  // 官方注：v4-flash / v4-flash-vision-exp 已下线，仍按 Flash 价格计费
  assert.equal(api.modelFamily('deepseek-v4-flash'), 'flash');
  assert.equal(api.modelFamily('deepseek-v4-flash-vision-exp'), 'flash');
  // 2026-07-24 停用的别名：chat（非思考）/reasoner（思考，含 r1）→ flash 价估算
  assert.equal(api.modelFamily('deepseek-chat'), 'flash');
  assert.equal(api.modelFamily('deepseek-reasoner'), 'flash');
  assert.equal(api.modelFamily('r1'), 'flash');
});

test('isPeakNow: Beijing weekday 9-12 / 14-18, not weekends', () => {
  assert.equal(api.isPeakNow(BJT('2026-11-16T01:00:00')), true); // 周一 09:00
  assert.equal(api.isPeakNow(BJT('2026-11-16T03:59:59')), true); // 周一 11:59:59
  assert.equal(api.isPeakNow(BJT('2026-11-16T04:00:00')), false); // 周一 12:00
  assert.equal(api.isPeakNow(BJT('2026-11-16T06:00:00')), true); // 周一 14:00
  assert.equal(api.isPeakNow(BJT('2026-11-16T09:59:59')), true); // 周一 17:59:59
  assert.equal(api.isPeakNow(BJT('2026-11-16T10:00:00')), false); // 周一 18:00
  assert.equal(api.isPeakNow(BJT('2026-11-15T01:00:00')), false); // 周日 09:00
  assert.equal(api.isPeakNow(BJT('2026-11-16T00:30:00')), false); // 周一 08:30
});

test('estimateCostFor: flash idle = hit 0.02 / miss 1 / out 4 (CNY per 1M)', () => {
  const u = { input: 1e6, cacheRead: 1e6, cacheWrite: 0, output: 1e6 };
  // 1 (miss) + 0.02 (hit) + 4 (out)
  assert.ok(Math.abs(api.estimateCostFor(u, 'deepseek-flash', false) - 5.02) < 1e-9);
});

test('estimateCostFor: flash peak doubles; v4-pro = hit .15/.30 miss 4.5/9 out 13.5/27', () => {
  const u = { input: 1e6, cacheRead: 1e6, cacheWrite: 0, output: 1e6 };
  assert.ok(Math.abs(api.estimateCostFor(u, 'deepseek-flash', true) - 10.04) < 1e-9);
  assert.ok(Math.abs(api.estimateCostFor(u, 'deepseek-v4-pro', false) - 18.15) < 1e-9); // 4.5+0.15+13.5
  assert.ok(Math.abs(api.estimateCostFor(u, 'deepseek-v4-pro', true) - 36.3) < 1e-9); // 9+0.30+27
});

test('estimateCost: retired chat / reasoner are estimated at flash prices', () => {
  const idle = BJT('2026-11-15T01:00:00');
  const u = { input: 1e6, cacheRead: 0, cacheWrite: 0, output: 1e6 };
  assert.ok(Math.abs(api.estimateCost(u, 'deepseek-chat', idle) - 5) < 1e-9); // 1+4 (flash idle)
  assert.ok(Math.abs(api.estimateCost(u, 'deepseek-reasoner', idle) - 5) < 1e-9);
});

test('estimateCostFor: cacheWrite billed at miss price; reasoning NOT double-billed', () => {
  const base = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const withReasoning = { ...base, reasoning: 1e6 };
  assert.equal(api.estimateCostFor(withReasoning, 'deepseek-flash', false), 0);
  const withCacheWrite = { ...base, cacheWrite: 1e6 };
  assert.ok(Math.abs(api.estimateCostFor(withCacheWrite, 'deepseek-flash', false) - 1) < 1e-9);
});

test('estimateCostFor: unknown model → null; null usage → null', () => {
  assert.equal(api.estimateCostFor({ input: 100 }, 'gpt-4o', false), null);
  assert.equal(api.estimateCostFor(null, 'deepseek-flash', false), null);
  assert.equal(api.estimateCostFor(undefined, 'deepseek-flash', false), null);
});

test('costLine: 暂无用量 / 价格未知 / 约 ¥…（估）(no-segments fallback)', () => {
  assert.equal(api.costLine(null), '暂无用量');
  assert.equal(api.costLine(undefined), '暂无用量');
  assert.equal(api.costLine({}), '暂无用量');
  assert.equal(api.costLine({ usage: { input: 100 }, model: 'gpt-4o' }), '价格未知');
  const line = api.costLine({
    usage: { input: 1e6, cacheRead: 0, cacheWrite: 0, output: 1e6 },
    model: 'deepseek-flash',
  });
  assert.match(line, /^约 ¥\d+(\.\d{2})?（估）$/);
});

test('costLine: segments are priced per segment (model × peak), not by current model/time', () => {
  const u1m = { input: 1e6, cacheRead: 0, cacheWrite: 0, output: 0 };
  const snap = {
    usage: { input: 3e6, output: 0, cacheRead: 0, cacheWrite: 0 },
    model: 'deepseek-v4-pro', // 当前模型是 v4-pro——但分段必须按各自模型/时段算
    segments: [
      { model: 'deepseek-flash', idle: u1m, peak: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } },
      { model: 'deepseek-flash', idle: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, peak: u1m },
      { model: 'deepseek-v4-pro', idle: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, peak: u1m },
    ],
  };
  // 1M flash idle (¥1) + 1M flash peak (¥2) + 1M v4-pro peak (¥9) = 12
  const line = api.costLine(snap);
  assert.equal(line, '约 ' + api.fmtMoney(12) + '（估）');
});

test('costLine: any unknown-model segment → 价格未知 (honest, not silently wrong)', () => {
  const snap = {
    usage: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 },
    segments: [
      { model: 'deepseek-flash', idle: { input: 1, cacheRead: 0, cacheWrite: 0, output: 0 }, peak: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } },
      { model: 'some-future-model', idle: { input: 1, cacheRead: 0, cacheWrite: 0, output: 0 }, peak: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } },
    ],
  };
  assert.equal(api.costLine(snap), '价格未知');
});

test('costLine: segments not reconciling with usage totals fall back (v1 migration undercount guard)', () => {
  // v1 → v2 迁移：usage 是完整历史（1M input），segments 只覆盖迁移后的新事件（100 tokens）
  const snap = {
    usage: { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 },
    model: 'deepseek-flash',
    segments: [
      { model: 'deepseek-flash', idle: { input: 100, cacheRead: 0, cacheWrite: 0, output: 0 }, peak: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } },
    ],
  };
  // 逐段计价会只算 100 tokens（≈¥0.00）——必须回退整段估算而不是低估
  assert.match(api.costLine(snap), /^约 ¥\d+(\.\d{2})?（估）$/);
  assert.doesNotMatch(api.costLine(snap), /^约 ¥0\.00/);
});

test('costLine: empty segments array falls back to whole-session estimate', () => {
  const snap = {
    usage: { input: 1e6, cacheRead: 0, cacheWrite: 0, output: 1e6 },
    model: 'deepseek-flash',
    segments: [],
  };
  assert.match(api.costLine(snap), /^约 ¥\d+(\.\d{2})?（估）$/);
});
