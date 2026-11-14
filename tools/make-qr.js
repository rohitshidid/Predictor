#!/usr/bin/env node
// Dependency-free QR code generator for the graphic's "learn more" QR.
//
//   node tools/make-qr.js <url> <out.png> [--ecl H] [--quiet 2] [--px 16]
//
// WBBL:  node tools/make-qr.js https://www.champhunt.com/wbbl public/logos/qr-wbbl.png
//
// Byte mode, versions 1-6 (plenty for a URL), error-correction L/M/Q/H, the
// standard mask-penalty selection, written as a 1-bit-per-module PNG with the
// quiet zone included. Kept in-repo rather than pulled from npm so the asset can
// be regenerated on a laptop with nothing installed. Verified by reproducing the
// CPL edition's public/logos/qr.png (https://www.champhunt.com/cpl, level H)
// module for module.
'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

// [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] per version (1-6) and level.
const BLOCKS = {
  1: { L: [7, 1, 19], M: [10, 1, 16], Q: [13, 1, 13], H: [17, 1, 9] },
  2: { L: [10, 1, 34], M: [16, 1, 28], Q: [22, 1, 22], H: [28, 1, 16] },
  3: { L: [15, 1, 55], M: [26, 1, 44], Q: [18, 2, 17], H: [22, 2, 13] },
  4: { L: [20, 1, 80], M: [18, 2, 32], Q: [26, 2, 24], H: [16, 4, 9] },
  5: { L: [26, 1, 108], M: [24, 2, 43], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68], M: [16, 4, 27], Q: [24, 4, 19], H: [28, 4, 15] },
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// ---- Reed-Solomon over GF(256), polynomial 0x11D -----------------------------
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

// ---- data codewords ------------------------------------------------------------
function dataCapacity(spec) {
  const [, b1, d1, b2 = 0, d2 = 0] = spec;
  return b1 * d1 + b2 * d2;
}
function encodeData(bytes, version, ecl) {
  const cap = dataCapacity(BLOCKS[version][ecl]);
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);              // byte mode
  put(bytes.length, 8);        // count (versions 1-9)
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < cap; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}
function interleave(data, version, ecl) {
  const [ec, b1, d1, b2 = 0, d2 = 0] = BLOCKS[version][ecl];
  const blocks = [];
  let k = 0;
  for (let i = 0; i < b1; i++) { blocks.push(data.slice(k, k + d1)); k += d1; }
  for (let i = 0; i < b2; i++) { blocks.push(data.slice(k, k + d2)); k += d2; }
  const div = rsDivisor(ec);
  const ecc = blocks.map((b) => rsRemainder(b, div));
  const out = [];
  const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const e of ecc) out.push(e[i]);
  return out;
}

// ---- matrix ---------------------------------------------------------------------
function buildMatrix(codewords, version, ecl, mask) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = ALIGN[version];
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormat(set, size, ecl, mask);

  // Zig-zag data placement.
  let i = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < total) {
          m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
  // Mask.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (fn[y][x]) continue;
    let inv;
    switch (mask) {
      case 0: inv = (x + y) % 2 === 0; break;
      case 1: inv = y % 2 === 0; break;
      case 2: inv = x % 3 === 0; break;
      case 3: inv = (x + y) % 3 === 0; break;
      case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
      case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
      case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
      default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
    if (inv) m[y][x] = !m[y][x];
  }
  return m;
}
function drawFormat(set, size, ecl, mask) {
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

// Standard penalty (ISO 18004 §7.8.3): runs, 2x2 blocks, finder-like patterns, balance.
function penalty(m) {
  const n = m.length;
  let score = 0;
  const lines = [];
  for (let y = 0; y < n; y++) lines.push(m[y]);
  for (let x = 0; x < n; x++) lines.push(m.map((row) => row[x]));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    const s = line.map((b) => (b ? '1' : '0')).join('');
    for (const pat of ['10111010000', '00001011101']) {
      let k = s.indexOf(pat);
      while (k !== -1) { score += 40; k = s.indexOf(pat, k + 1); }
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return score;
}

function encode(text, ecl = 'H', forcedMask = null) {
  const bytes = [...Buffer.from(text, 'utf8')];
  let version = 0;
  for (let v = 1; v <= 6; v++) {
    if (dataCapacity(BLOCKS[v][ecl]) * 8 >= 12 + bytes.length * 8) { version = v; break; }
  }
  if (!version) throw new Error(`too long for versions 1-6 at level ${ecl}: ${bytes.length} bytes`);
  const cw = interleave(encodeData(bytes, version, ecl), version, ecl);
  if (forcedMask != null) return { version, mask: forcedMask, matrix: buildMatrix(cw, version, ecl, forcedMask) };
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = buildMatrix(cw, version, ecl, mask);
    const p = penalty(matrix);
    if (!best || p < best.p) best = { version, mask, matrix, p };
  }
  return best;
}

// 8-bit greyscale PNG, black modules on white, quiet zone included.
function toPng(matrix, quiet = 2, px = 16) {
  const n = matrix.length + quiet * 2;
  const w = n * px;
  const raw = Buffer.alloc((w + 1) * w);
  for (let y = 0; y < w; y++) {
    raw[y * (w + 1)] = 0;
    const my = Math.floor(y / px) - quiet;
    for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / px) - quiet;
      const dark = my >= 0 && mx >= 0 && my < matrix.length && mx < matrix.length && matrix[my][mx];
      raw[y * (w + 1) + 1 + x] = dark ? 0 : 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
  const ecl = flag('--ecl', 'H').toUpperCase();
  const quiet = +flag('--quiet', 2);
  const px = +flag('--px', 16);
  const [url, out] = args;
  if (!url || !out) { console.error('usage: node tools/make-qr.js <url> <out.png> [--ecl H] [--quiet 2] [--px 16]'); process.exit(2); }
  const q = encode(url, ecl);
  fs.writeFileSync(out, toPng(q.matrix, quiet, px));
  console.log(`wrote ${out}: version ${q.version}, level ${ecl}, mask ${q.mask}, ${q.matrix.length + 2 * quiet} modules incl. quiet zone`);
}

module.exports = { encode, toPng };
