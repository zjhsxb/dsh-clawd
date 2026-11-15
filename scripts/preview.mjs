// scripts/preview.mjs —— 从 client.js 原样抽取精灵数据，渲染接触表 PNG 与 icon.svg
// 用法: node scripts/preview.mjs  （改完 client.js 的 SPRITE_BASE/FRAME_SPEC 后跑一次目检）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const clientSrc = readFileSync(join(root, 'client.js'), 'utf8');

function extract(name) {
  const open = '/* @' + name + ' */';
  const close = '/* @' + name + '-end */';
  const a = clientSrc.indexOf(open);
  const b = clientSrc.indexOf(close);
  if (a < 0 || b < 0 || b <= a) throw new Error('未找到 @' + name + ' 标记块');
  return clientSrc.slice(a + open.length, b);
}

const SPRITE_BASE = new Function('var GRID=24;' + extract('sprite-base') + '; return SPRITE_BASE;')();
const FRAME_SPEC = new Function('var GRID=24;' + extract('sprite-spec') + '; return FRAME_SPEC;')();
const compileFrames = new Function('var GRID=24;' + extract('sprite-compile') + '; return compileFrames;')();

// —— 基础校验 ——
if (!Array.isArray(SPRITE_BASE) || SPRITE_BASE.length !== 24) throw new Error('SPRITE_BASE 必须是 24 行');
SPRITE_BASE.forEach((row, i) => {
  if (row.length !== 24) throw new Error('SPRITE_BASE 第 ' + i + ' 行长度 ' + row.length + ' ≠ 24');
});
const PALETTE = { o:'#3D2A20', D:'#B95E3B', O:'#D97757', C:'#F5F0E8', b:'#2B1B12', w:'#FFFFFF', r:'#E8847A', y:'#F0B65A' };
const frames = compileFrames(SPRITE_BASE, FRAME_SPEC);
const states = Object.keys(frames);
for (const st of states) {
  for (const [fi, grid] of frames[st].frames.entries()) {
    if (grid.length !== 24) throw new Error(`${st}[${fi}] 行数 ${grid.length} ≠ 24`);
    grid.forEach((row, r) => {
      if (row.length !== 24) throw new Error(`${st}[${fi}] 第 ${r} 行长度 ${row.length} ≠ 24`);
      for (const ch of row) {
        if (ch !== '.' && ch !== ' ' && !PALETTE[ch]) throw new Error(`${st}[${fi}] 出现未知调色板字符 "${ch}"`);
      }
    });
  }
}
console.log('状态:', states.join(', '));
for (const st of states) console.log(' ', st, '×', frames[st].frames.length, frames[st].repeat ? '(repeat ' + frames[st].repeat + ')' : '');

// —— PNG 编码（无依赖：node:zlib + 手写 chunk/CRC32）——
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// —— 渲染接触表 ——
const SCALE = 8;
const GAP = 6;
const ROW_GAP = 18;
const BG = [245, 240, 232, 255]; // 奶油底
const stateOrder = ['idle', 'blink', 'walk', 'think', 'work', 'success', 'error', 'sleep', 'eat', 'drag', 'happy'];
const maxFrames = Math.max(...stateOrder.map(s => frames[s].frames.length));
const cell = 24 * SCALE;
const width = maxFrames * cell + (maxFrames - 1) * GAP + GAP * 2;
const height = stateOrder.length * cell + (stateOrder.length - 1) * ROW_GAP + GAP * 2;
const img = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i++) img.set(BG, i * 4);

function hexToRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function put(x, y, rgb) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const o = (y * width + x) * 4;
  img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2]; img[o + 3] = 255;
}

stateOrder.forEach((st, si) => {
  const rowY = GAP + si * (cell + ROW_GAP);
  frames[st].frames.forEach((grid, fi) => {
    const ox = GAP + fi * (cell + GAP);
    for (let r = 0; r < 24; r++) {
      for (let c = 0; c < 24; c++) {
        const ch = grid[r][c];
        if (ch === '.' || ch === ' ') continue;
        const rgb = hexToRgb(PALETTE[ch]);
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) put(ox + c * SCALE + dx, rowY + r * SCALE + dy, rgb);
        }
      }
    }
  });
});

const outDir = join(root, 'assets');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'preview.png'), encodePNG(width, height, img));
console.log('已写出 assets/preview.png（' + width + '×' + height + '，行序 = ' + stateOrder.join(' > ') + '）');

// —— 生成 icon.svg（idle 第 1 帧，36×36 viewBox，1.5 倍放大）——
const grid = frames.idle.frames[0];
const P = 1.5;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" shape-rendering="crispEdges">\n`;
for (let r = 0; r < 24; r++) {
  let c = 0;
  while (c < 24) {
    const ch = grid[r][c];
    if (ch === '.' || ch === ' ') { c++; continue; }
    let run = 1;
    while (c + run < 24 && grid[r][c + run] === ch) run++;
    svg += `  <rect x="${(c * P).toFixed(2)}" y="${(r * P).toFixed(2)}" width="${(run * P).toFixed(2)}" height="${P.toFixed(2)}" fill="${PALETTE[ch]}"/>\n`;
    c += run;
  }
}
svg += '</svg>\n';
writeFileSync(join(outDir, 'icon.svg'), svg);
console.log('已写出 assets/icon.svg');
