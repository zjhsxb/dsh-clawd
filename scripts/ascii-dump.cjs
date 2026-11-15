// scripts/ascii-dump.cjs —— 把编译后的帧打成 ASCII 便于文本目检
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const src = readFileSync(join(__dirname, '..', 'client.js'), 'utf8');
function extract(name) {
  const open = '/* @' + name + ' */';
  const close = '/* @' + name + '-end */';
  const a = src.indexOf(open), b = src.indexOf(close);
  return src.slice(a + open.length, b);
}
const GRID = 24;
const SPRITE_BASE = new Function('var GRID=24;' + extract('sprite-base') + '; return SPRITE_BASE;')();
const FRAME_SPEC = new Function('var GRID=24;' + extract('sprite-spec') + '; return FRAME_SPEC;')();
const compileFrames = new Function('var GRID=24;' + extract('sprite-compile') + '; return compileFrames;')();
const frames = compileFrames(SPRITE_BASE, FRAME_SPEC);
const which = (process.argv[2] || 'idle').split(',');
for (const st of which) {
  if (!frames[st]) { console.error('无状态:', st); process.exit(1); }
  frames[st].frames.forEach((grid, i) => {
    console.log(`=== ${st}[${i}] ===`);
    for (const row of grid) console.log((Array.isArray(row) ? row.join('') : row).replace(/\./g, ' '));
    console.log('');
  });
}
