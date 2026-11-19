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
  m[1] + '\nreturn { PRICE_TABLE, modelFamily, isPeakNow, estimateCost, fmtMoney, costLine };',
)();

// 北京时间：本地时区 Asia/Shanghai（+8），构造 UTC 时间戳。
// 2026-11-16 是周一；2026-11-15 是周日。
const BJT = (s) => new Date(s + 'Z');

test('modelFamily maps official names; unknown models map to null', () => {
  assert.equal(api.modelFamily('deepseek-flash'), 'flash');
  assert.equal(api.modelFamily('deepseek-v4-flash'), 'flash');
  assert.equal(api.modelFamily('DeepSeek-V4.1-Flash-1017'), 'flash');
  assert.equal(api.modelFamily('deepseek-v4-pro'), 'v4-pro');
  assert.equal(api.modelFamily('deepseek-chat'), 'chat');
  assert.equal(api.modelFamily('deepseek-reasoner'), 'reasoner');
  assert.equal(api.modelFamily('r1'), 'reasoner');
  assert.equal(api.modelFamily('gpt-4o'), null);
  assert.equal(api.modelFamily(''), null);
  assert.equal(api.modelFamily(null), null);
  assert.equal(api.modelFamily(123), null);
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

test('estimateCost: flash idle = hit 0.02 / miss 1 / out 2 (CNY per 1M)', () => {
  const idle = BJT('2026-11-15T01:00:00'); // 周日
  const u = { input: 1e6, cacheRead: 1e6, cacheWrite: 0, output: 1e6 };
  // 1 (miss) + 0.02 (hit) + 2 (out)
  assert.ok(Math.abs(api.estimateCost(u, 'deepseek-flash', idle) - 3.02) < 1e-9);
});

test('estimateCost: flash peak doubles; v4-pro = hit .15/.30 miss 3/6 out 6/12', () => {
  const peak = BJT('2026-11-16T02:00:00'); // 周一 10:00
  const idle = BJT('2026-11-15T01:00:00'); // 周日
  const u = { input: 1e6, cacheRead: 1e6, cacheWrite: 0, output: 1e6 };
  assert.ok(Math.abs(api.estimateCost(u, 'deepseek-flash', peak) - 6.04) < 1e-9);
  assert.ok(Math.abs(api.estimateCost(u, 'deepseek-v4-pro', idle) - 9.15) < 1e-9); // 3+0.15+6
  assert.ok(Math.abs(api.estimateCost(u, 'deepseek-v4-pro', peak) - 18.3) < 1e-9); // 6+0.30+12
});

test('estimateCost: legacy chat / reasoner aliases still priced', () => {
  const idle = BJT('2026-11-15T01:00:00');
  const u = { input: 1e6, cacheRead: 0, cacheWrite: 0, output: 1e6 };
  assert.ok(Math.abs(api.estimateCost(u, 'deepseek-chat', idle) - 10) < 1e-9); // 2+8
  assert.ok(Math.abs(api.estimateCost(u, 'deepseek-reasoner', idle) - 20) < 1e-9); // 4+16
});

test('estimateCost: cacheWrite billed at miss price; reasoning NOT double-billed', () => {
  const idle = BJT('2026-11-15T01:00:00');
  const base = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const withReasoning = { ...base, reasoning: 1e6 };
  assert.equal(api.estimateCost(withReasoning, 'deepseek-flash', idle), 0); // reasoning contributes nothing
  const withCacheWrite = { ...base, cacheWrite: 1e6 };
  assert.ok(Math.abs(api.estimateCost(withCacheWrite, 'deepseek-flash', idle) - 1) < 1e-9); // 1e6 cacheWrite × miss ¥1
});

test('estimateCost: unknown model → null; null usage → null', () => {
  const idle = BJT('2026-11-15T01:00:00');
  assert.equal(api.estimateCost({ input: 100 }, 'gpt-4o', idle), null);
  assert.equal(api.estimateCost(null, 'deepseek-flash', idle), null);
  assert.equal(api.estimateCost(undefined, 'deepseek-flash', idle), null);
});

test('costLine: 暂无用量 / 价格未知 / 约 ¥…（估）', () => {
  const idle = BJT('2026-11-15T01:00:00');
  assert.equal(api.costLine(null, 'deepseek-flash'), '暂无用量');
  assert.equal(api.costLine(undefined, 'deepseek-flash'), '暂无用量');
  assert.equal(api.costLine({ input: 100 }, 'gpt-4o'), '价格未知');
  const line = api.costLine({ input: 1e6, cacheRead: 0, cacheWrite: 0, output: 1e6 }, 'deepseek-flash');
  assert.match(line, /^约 ¥\d+(\.\d{2})?（估）$/);
});

test('price table values match DeepSeek official permanent prices (source of truth in comments)', () => {
  assert.deepEqual(api.PRICE_TABLE.flash, [0.02, 0.04, 1, 2, 2, 4]);
  assert.deepEqual(api.PRICE_TABLE['v4-pro'], [0.15, 0.3, 3, 6, 6, 12]);
  assert.deepEqual(api.PRICE_TABLE.chat, [0.5, 1, 2, 4, 8, 16]);
  assert.deepEqual(api.PRICE_TABLE.reasoner, [1, 2, 4, 8, 16, 32]);
});
