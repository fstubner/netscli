// Rasterise the xtctx brand SVGs in this directory into the files the site
// serves. Run from site/: node brand/render.mjs
//
// PNG for the wordmark because the nav and docs bars read branding.wordmark
// as a bitmap asset and scripts/wordmark-inset.mjs measures it. Rendered at
// about 3x the size the bars show it, so it stays sharp on a high-DPI screen.
import sharp from 'sharp';

const HEIGHT = 120;
for (const [src, out] of [
  ['brand/wordmark-dark.svg', 'public/assets/wordmark.png'],
  ['brand/wordmark-light.svg', 'public/assets/wordmark-light.png'],
]) {
  const info = await sharp(src, { density: 600 }).resize({ height: HEIGHT }).png().toFile(out);
  console.log(`${out} ${info.width}x${info.height}`);
}
const touch = await sharp('public/favicon.svg', { density: 600 }).resize(180, 180).png().toFile('public/apple-touch-icon.png');
console.log(`public/apple-touch-icon.png ${touch.width}x${touch.height}`);
