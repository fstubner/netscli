import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const maxLines = 300;
const roots = [
  'apps/netscli-cli/src',
  'apps/netscli-cli/tests',
  'apps/netscli-gui/e2e',
  'apps/netscli-gui/src',
  'apps/netscli-gui/src-tauri/src',
  'crates/netscli-core/src',
  'crates/netscli-core/tests',
  'crates/netscli-mcp/src',
  'crates/netscli-mcp/tests',
];
const extensions = new Set(['.css', '.mjs', '.rs', '.ts', '.tsx']);
const ignoredDirs = new Set(['node_modules', 'dist', 'target']);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        walk(path.join(dir, entry.name), files);
      }
      continue;
    }
    if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const oversized = [];
for (const root of roots) {
  for (const file of walk(path.join(repoRoot, root))) {
    const lineCount = fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
    if (lineCount > maxLines) {
      oversized.push({
        lines: lineCount,
        file: path.relative(repoRoot, file).replaceAll(path.sep, '/'),
      });
    }
  }
}

if (oversized.length > 0) {
  oversized.sort((a, b) => b.lines - a.lines);
  console.error(`Files over ${maxLines} lines:`);
  for (const item of oversized) {
    console.error(`  ${item.lines.toString().padStart(4)}  ${item.file}`);
  }
  process.exitCode = 1;
}
