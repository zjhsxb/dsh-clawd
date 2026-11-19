// dsh-clawd sprite integrity tests: extracts the REAL @sprite-* blocks from
// client.js, compiles them, and verifies every frame is a valid 24×24 grid
// using only declared palette characters. Guards against grid corruption in
// future sprite edits (same blocks scripts/preview.mjs renders from).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client.js'),
  'utf8',
);

function extract(marker, end) {
  const m = clientSrc.match(new RegExp('/\\* ' + marker + ' \\*/\\n([\\s\\S]*?)\\n\\s*/\\* ' + end + ' \\*/'));
  assert.ok(m, marker + ' block found');
  return m[1];
}

const gridDecl = clientSrc.match(/var GRID = (\d+);/);
const paletteDecl = clientSrc.match(/var PALETTE = \{([\s\S]*?)\n\s*\};/);
assert.ok(gridDecl && paletteDecl, 'GRID and PALETTE declarations found');

const api = new Function(
  'var GRID = ' + gridDecl[1] + ';\n' +
    'var PALETTE = {' + paletteDecl[1] + '\n};\n' +
    extract('@sprite-base', '@sprite-base-end') + '\n' +
    extract('@sprite-spec', '@sprite-spec-end') + '\n' +
    extract('@sprite-compile', '@sprite-compile-end') + '\n' +
    'return { GRID, PALETTE, SPRITE_BASE, FRAME_SPEC, compileFrames };',
)();

const EXPECTED_STATES = ['idle', 'blink', 'walk', 'think', 'work', 'success', 'error', 'sleep', 'eat', 'drag', 'happy'];
const paletteChars = new Set(Object.keys(api.PALETTE));

function assertGrid(frame, label) {
  assert.equal(frame.length, api.GRID, label + ': row count');
  for (let r = 0; r < api.GRID; r++) {
    const row = frame[r];
    assert.equal(row.length, api.GRID, `${label}: row ${r} width`);
    for (const ch of row) {
      // '.' is the base grid's transparent char (drawGrid skips '.' and ' ',
      // see client.js drawGrid); only REAL palette-unknown chars fail.
      assert.ok(ch === ' ' || ch === '.' || paletteChars.has(ch), `${label}: row ${r} char "${ch}" not in palette`);
    }
  }
}

test('SPRITE_BASE is a valid GRID×GRID grid of palette chars', () => {
  assert.equal(api.SPRITE_BASE.length, api.GRID);
  for (let r = 0; r < api.GRID; r++) {
    const row = api.SPRITE_BASE[r];
    assert.equal(row.length, api.GRID, `base row ${r} width`);
    for (const ch of row) {
      assert.ok(ch === ' ' || ch === '.' || paletteChars.has(ch), `base row ${r} char "${ch}"`);
    }
  }
});

test('every FRAME_SPEC state compiles into valid frames', () => {
  const compiled = api.compileFrames(api.SPRITE_BASE, api.FRAME_SPEC);
  assert.deepEqual(Object.keys(compiled).sort(), EXPECTED_STATES.slice().sort());
  for (const state of EXPECTED_STATES) {
    const def = compiled[state];
    assert.ok(def.frames.length >= 1, state + ' has frames');
    def.frames.forEach((f, i) => assertGrid(f, state + '#' + i));
  }
});

test('frames actually differ from the base (sprite edits are not no-ops)', () => {
  const compiled = api.compileFrames(api.SPRITE_BASE, api.FRAME_SPEC);
  const flat = (g) => g.map((r) => (Array.isArray(r) ? r.join('') : r)).join('\n');
  const baseFlat = flat(api.SPRITE_BASE);
  let changed = 0;
  for (const state of EXPECTED_STATES) {
    for (const f of compiled[state].frames) {
      if (flat(f) !== baseFlat) changed++;
    }
  }
  assert.ok(changed >= 5, 'at least 5 frames deviate from base (idle frame 0 may equal base)');
});
