// Renders the BlockTheNoise icon (muted sound bars on a dark tile) to PNGs with no dependencies.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// Pass "<size> <path>" to render one extra size, e.g. a large logo for store graphics.
const [customSize, customPath] = process.argv.slice(2);
const SIZES = customSize ? [Number(customSize)] : [16, 32, 48, 128];
const SS = 4; // supersampling per axis

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Returns [r,g,b,a] for a point in unit space (0..1).
function sample(x, y) {
  const cx = x - 0.5, cy = y - 0.5;
  // Rounded-square tile.
  const r = 0.22, h = 0.5 - r;
  const qx = Math.max(Math.abs(cx) - h, 0), qy = Math.max(Math.abs(cy) - h, 0);
  if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];
  const red = [229, 72, 77, 255];
  const white = [240, 242, 247, 255];
  const tile = [24, 27, 35, 255];

  // Slash from top-right to bottom-left, with a dark gap so it visibly cuts the bars.
  const slashDist = Math.abs(cx + cy) / Math.SQRT2;
  const slashAlong = Math.abs(cx - cy) / Math.SQRT2;
  const slashLen = 0.31, slashWidth = 0.045, gap = 0.04;
  const slashCap = Math.hypot(Math.max(slashAlong - slashLen, 0), slashDist);
  if (slashCap < slashWidth) return white;
  if (slashCap < slashWidth + gap) return tile;

  // Sound bars: rounded vertical capsules of varying height, like an audio meter.
  const barWidth = 0.042;
  const bars = [
    [-0.24, 0.09],
    [-0.12, 0.19],
    [0, 0.27],
    [0.12, 0.19],
    [0.24, 0.09],
  ];
  for (const [bx, bh] of bars) {
    if (Math.hypot(cx - bx, Math.max(Math.abs(cy) - bh, 0)) < barWidth) return red;
  }
  return tile;
}

for (const size of SIZES) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [r, g, b, a] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; acc[3] += a;
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      px[i + 3] = Math.round(acc[3] / n);
      if (acc[3] > 0) for (let c = 0; c < 3; c++) px[i + c] = Math.round(acc[c] / acc[3]);
    }
  }
  writeFileSync(customPath ?? `static/icons/icon${size}.png`, encodePng(size, px));
}
console.log(customPath ? `Wrote ${customPath}` : `Wrote ${SIZES.length} icons to static/icons/`);
