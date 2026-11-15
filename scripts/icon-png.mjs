// scripts/icon-png.mjs —— 用 idle 首帧渲染市场卡片位图 assets/icon-192.png（192×192，8× 整数缩放）
// 用法: node scripts/icon-png.mjs
// 原因: awesome-dsh-plugin 目录条目只接受 GitHub 托管的 png/jpg/jpeg/webp 位图（SVG 会被拒绝）
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
const PALETTE = { o:'#3D2A20', D:'#B95E3B', O:'#D97757', C:'#F5F0E8', b:'#2B1B12', w:'#FFFFFF', r:'#E8847A', y:'#F0B65A' };

const frames = compileFrames(SPRITE_BASE, FRAME_SPEC);
const grid = frames.idle.frames[0];

// —— PNG 编码（无依赖）——
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
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function hexToRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// 透明底 + 奶油圆角卡片底 + 精灵居中
const SCALE = 8;
const SIZE = 24 * SCALE; // 192
const img = Buffer.alloc(SIZE * SIZE * 4); // 默认透明
function put(x, y, rgb, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const o = (y * SIZE + x) * 4;
  img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2]; img[o + 3] = a === undefined ? 255 : a;
}
// 圆角奶油底（半径 24px）
const BG = hexToRgb('#F5F0E8');
const R = 24;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let inside = true;
    if (x < R && y < R && (x - R) * (x - R) + (y - R) * (y - R) > R * R) inside = false;
    else if (x >= SIZE - R && y < R && (x - (SIZE - R)) * (x - (SIZE - R)) + (y - R) * (y - R) > R * R) inside = false;
    else if (x < R && y >= SIZE - R && (x - R) * (x - R) + (y - (SIZE - R)) * (y - (SIZE - R)) > R * R) inside = false;
    else if (x >= SIZE - R && y >= SIZE - R && (x - (SIZE - R)) * (x - (SIZE - R)) + (y - (SIZE - R)) * (y - (SIZE - R)) > R * R) inside = false;
    if (inside) put(x, y, BG);
  }
}
for (let r = 0; r < 24; r++) {
  for (let c = 0; c < 24; c++) {
    const ch = grid[r][c];
    if (ch === '.' || ch === ' ') continue;
    const rgb = hexToRgb(PALETTE[ch]);
    for (let dy = 0; dy < SCALE; dy++) {
      for (let dx = 0; dx < SCALE; dx++) put(c * SCALE + dx, r * SCALE + dy, rgb);
    }
  }
}
const outDir = join(root, 'assets');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon-192.png'), encodePNG(SIZE, SIZE, img));
console.log('已写出 assets/icon-192.png（' + SIZE + '×' + SIZE + '）');
