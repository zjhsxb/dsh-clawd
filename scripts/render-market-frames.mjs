// scripts/render-market-frames.mjs —— 从 client.js 精灵标记块渲染市场宣传所需帧（透明底 PNG，整数倍放大）
// 用法: node scripts/render-market-frames.mjs
// 输出: docs/market/.build/frames/<mood>_<idx>@<scale>.png（RGBA，透明背景，纯像素放大）
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

const compiled = compileFrames(SPRITE_BASE, FRAME_SPEC);

// —— 无依赖 PNG 编码（RGBA，透明底）——
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
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function hexToRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function renderFrame(state, idx, scale) {
  const frames = compiled[state].frames;
  if (idx >= frames.length) throw new Error(state + ' 没有第 ' + idx + ' 帧');
  const grid = frames[idx];
  const S = 24 * scale;
  const img = Buffer.alloc(S * S * 4); // 全透明
  for (let r = 0; r < 24; r++) {
    const row = grid[r];
    for (let c = 0; c < 24; c++) {
      const ch = row[c];
      if (ch === '.' || ch === ' ') continue;
      const rgb = hexToRgb(PALETTE[ch]);
      if (!rgb) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const o = ((r * scale + dy) * S + c * scale + dx) * 4;
          img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2]; img[o + 3] = 255;
        }
      }
    }
  }
  return img;
}

// 帧清单：<mood>_<frameIdx>@<scale>
const WANT = [
  ['idle', 0, 6], ['idle', 0, 12], ['idle', 0, 24],
  ['walk', 0, 6], ['walk', 1, 6], ['walk', 0, 12], ['walk', 1, 12],
  ['think', 0, 6], ['think', 0, 12],
  ['work', 1, 6], ['work', 1, 12],
  ['success', 0, 6], ['success', 0, 12],
  ['error', 1, 6], ['error', 1, 12],
  ['sleep', 2, 6], ['sleep', 2, 12],
  ['eat', 1, 6], ['eat', 1, 12],
  ['drag', 0, 6], ['drag', 0, 12],
  ['happy', 1, 6], ['happy', 1, 12], ['happy', 1, 24],
];

const outDir = join(root, 'docs', 'market', '.build', 'frames');
mkdirSync(outDir, { recursive: true });
for (const [state, idx, scale] of WANT) {
  const img = renderFrame(state, idx, scale);
  const file = join(outDir, state + '_' + idx + '@' + scale + '.png');
  writeFileSync(file, encodePNG(24 * scale, 24 * scale, img));
  console.log('已写出', file.replace(root + '\\', ''));
}
console.log('帧渲染完成：' + WANT.length + ' 张');
