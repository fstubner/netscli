import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settingsPath = path.join(repoRoot, 'apps/netscli-gui/src/styles/shell/settings.css');
const lines = fs.readFileSync(settingsPath, 'utf8').split(/\r?\n/);
if (lines[0]?.startsWith('@import')) {
  console.log('settings.css already split');
  process.exit(0);
}

const outDir = path.join(repoRoot, 'apps/netscli-gui/src/styles/shell/settings');
fs.mkdirSync(outDir, { recursive: true });
const chunkSize = 320;
const parts = [];
for (let i = 0; i < lines.length; i += chunkSize) {
  const name = `settings-${String(Math.floor(i / chunkSize) + 1).padStart(2, '0')}.css`;
  fs.writeFileSync(path.join(outDir, name), `${lines.slice(i, i + chunkSize).join('\n')}\n`);
  parts.push(name);
}

const imports = parts.map((name) => `@import './settings/${name}';`).join('\n');
fs.writeFileSync(settingsPath, `${imports}\n`);
console.log(`settings split into ${parts.length} parts`);
