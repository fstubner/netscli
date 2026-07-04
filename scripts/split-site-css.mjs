import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function splitFile(relativeSrc, outDirRelative, prefix, chunkSize) {
  const src = path.join(repoRoot, relativeSrc);
  const outDir = path.join(repoRoot, outDirRelative);
  const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
  if (lines.length <= 2 && lines[0]?.startsWith('@import')) {
    throw new Error(`${relativeSrc} is already an import aggregator; split the module files instead`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const parts = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    const slice = lines.slice(i, i + chunkSize);
    const name = `${prefix}${String(Math.floor(i / chunkSize) + 1).padStart(2, '0')}.css`;
    fs.writeFileSync(path.join(outDir, name), `${slice.join('\n')}\n`);
    parts.push(name);
  }
  return { outDirRelative, parts };
}

const globalSplit = splitFile('site/src/styles/global.css', 'site/src/styles/global', 'global-', 350);
const starlightSplit = splitFile('site/src/styles/starlight.css', 'site/src/styles/starlight', 'starlight-', 900);

function writeAggregator(relativePath, split) {
  const imports = split.parts
    .map((name) => `@import './${path.basename(split.outDirRelative)}/${name}';`)
    .join('\n');
  fs.writeFileSync(path.join(repoRoot, relativePath), `${imports}\n`);
}

writeAggregator('site/src/styles/global.css', globalSplit);
writeAggregator('site/src/styles/starlight.css', starlightSplit);

console.log(`global: ${globalSplit.parts.length} parts`);
console.log(`starlight: ${starlightSplit.parts.length} parts`);
