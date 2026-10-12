// Generates icons/icon{16,48,128}.png: an orange rounded square with a white
// down arrow. Uses only Node built-ins. Run: node scripts/make-icons.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BG = [228, 87, 46];
const FG = [255, 255, 255];
const SAMPLES = 4; // 4x4 supersampling for smooth edges

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// Shapes in unit coordinates (0..1, y down).
function inRoundedSquare(x, y) {
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inArrow(x, y) {
  const shaft = Math.abs(x - 0.5) <= 0.075 && y >= 0.18 && y <= 0.56;
  const head = y >= 0.48 && y <= 0.82 && Math.abs(x - 0.5) <= (0.27 * (0.82 - y)) / 0.34;
  return shaft || head;
}

function render(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride); // each row starts with filter byte 0
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (!inRoundedSquare(x, y)) continue;
          if (inArrow(x, y)) fg++;
          else bg++;
        }
      }
      const covered = bg + fg;
      const i = py * stride + 1 + px * 4;
      for (let c = 0; c < 3; c++) raw[i + c] = covered ? Math.round((BG[c] * bg + FG[c] * fg) / covered) : 0;
      raw[i + 3] = Math.round((255 * covered) / (SAMPLES * SAMPLES));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), render(size));
}
console.log('Wrote icons/icon16.png, icon48.png, icon128.png');
