// Does --ui-mark-inset-ratio still match the wordmark asset?
//
// netscli-wordmark.png carries transparent columns down its left edge, so a
// bar that renders it flush against the gutter shows the logo indented while
// the links beside it are not. Both bars cancel that with a negative
// translate sized from the asset's own margin.
//
// This is checked rather than eyeballed because eyeballing it produced five
// different answers. Before tokens.css derived one value, the compensation
// was written as -10px on the landing bar, -18px on the docs bar, -8px below
// 72rem, -24px !important below 50rem, and omitted entirely on the landing
// page's narrow breakpoint -- against a real margin of 12.4px, 12.4px,
// 10.9px, 10.3px and 10.3px. Nobody chose those; they accumulated, and a
// wrong one is a few pixels of indent that renders as plausible and stays
// wrong for months.
//
// Re-exporting the wordmark with different padding silently invalidates the
// ratio and nothing else in the build would notice, which is the failure this
// guards. Exits non-zero on drift.
//
//   node ./scripts/wordmark-inset.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asset = path.join(siteRoot, 'public', 'assets', 'netscli-wordmark.png');
const tokens = path.join(siteRoot, 'src', 'styles', 'tokens.css');

// Half a pixel at the widest rendered width the site uses (160px). Below that
// the difference cannot reach a device pixel, so it is not worth failing over.
const TOLERANCE = 0.5 / 160;

/** Alpha channel of a truecolour-with-alpha, 8-bit PNG, as a w*h Uint8Array. */
function alphaChannel(file) {
  const buf = fs.readFileSync(file);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colourType = buf[25];
  if (bitDepth !== 8 || colourType !== 6) {
    throw new Error(
      `${path.basename(file)} is bit depth ${bitDepth}, colour type ${colourType}; ` +
        'this reader only handles 8-bit RGBA (type 6). Re-export it as RGBA, or ' +
        'teach this script the new format.'
    );
  }

  const chunks = [];
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at);
    if (buf.toString('ascii', at + 4, at + 8) === 'IDAT') {
      chunks.push(buf.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }

  // Undo the per-scanline filters (PNG spec 9.2). Each row is prefixed with a
  // filter byte and predicts from the pixel left (a), above (b), and
  // above-left (c).
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    for (let x = 0; x < stride; x += 1) {
      const i = y * stride + x;
      const a = x >= bpp ? out[i - bpp] : 0;
      const b = y > 0 ? out[i - stride] : 0;
      const c = x >= bpp && y > 0 ? out[i - stride - bpp] : 0;
      let value = raw[read];
      read += 1;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = value & 0xff;
    }
  }

  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) alpha[i] = out[i * 4 + 3];
  return { width, height, alpha };
}

const { width, height, alpha } = alphaChannel(asset);

// 8/255, not 0: a soft antialiased edge fades to a handful of alpha units
// well before it reaches nothing, and counting those as ink would report a
// margin a couple of columns short of where the glyph visibly starts.
const OPAQUE = 8;
let left = 0;
while (left < width) {
  let ink = false;
  for (let y = 0; y < height && !ink; y += 1) ink = alpha[y * width + left] > OPAQUE;
  if (ink) break;
  left += 1;
}

const measured = left / width;

const css = fs.readFileSync(tokens, 'utf8');
const declared = css.match(/--ui-mark-inset-ratio:\s*([\d.]+)\s*;/);
if (!declared) {
  console.error(
    `No --ui-mark-inset-ratio declaration in ${path.relative(siteRoot, tokens)}.\n` +
      `The wordmark's own left margin is ${measured.toFixed(4)} of its width ` +
      `(${left} of ${width} columns); declare that.`
  );
  process.exit(1);
}

const ratio = Number(declared[1]);
const drift = Math.abs(ratio - measured);

if (drift > TOLERANCE) {
  console.error(
    'Wordmark inset has drifted from the asset.\n' +
      `  declared  --ui-mark-inset-ratio: ${ratio}\n` +
      `  measured  ${measured.toFixed(4)} (${left} transparent columns of ${width})\n` +
      `  drift     ${(drift * 160).toFixed(2)}px at a 160px wordmark, tolerance 0.50px\n` +
      `Set the token to ${measured.toFixed(4)} in ${path.relative(siteRoot, tokens)}, ` +
      'or re-export the asset with its original padding.'
  );
  process.exit(1);
}

console.log(
  `Wordmark inset OK: declared ${ratio}, measured ${measured.toFixed(4)} ` +
    `(${left} of ${width} columns), off by ${(drift * 160).toFixed(2)}px at 160px.`
);
