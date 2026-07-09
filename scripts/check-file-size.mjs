import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maxLines = 300;
const transitionExceptions = new Map([
  [
    'apps/netscli-gui/src/tools/presentation.test.ts',
    {
      maxLines: 520,
      reason: 'broad presentation-helper fixture coverage; split by helper family next',
    },
  ],
  [
    'apps/netscli-gui/src-tauri/src/commands/files.rs',
    {
      maxLines: 500,
      reason: 'backend-owned file/export/capture dialogs; split by artifact family next',
    },
  ],
  [
    'apps/netscli-gui/src/styles/results.css',
    {
      maxLines: 460,
      reason: 'dense result/table/detail styling; split by table/detail/selection next',
    },
  ],
  [
    'apps/netscli-gui/src/workspace/useWorkspace.ts',
    {
      maxLines: 450,
      reason: 'workspace orchestration hook; split tab history/progress/actions next',
    },
  ],
  [
    'apps/netscli-gui/src/tools/presentation/details.ts',
    {
      maxLines: 410,
      reason: 'mode-specific detail models; split by operation family next',
    },
  ],
  [
    'apps/netscli-gui/src/components/shell/MenuBar.tsx',
    {
      maxLines: 395,
      reason: 'desktop menu composition; split menu groups/actions next',
    },
  ],
  [
    'apps/netscli-gui/src/styles/shell/settings.css',
    {
      maxLines: 395,
      reason: 'settings overlay styling; split sections/control primitives next',
    },
  ],
  [
    'apps/netscli-gui/src/components/results/DetailPane.tsx',
    {
      maxLines: 380,
      reason: 'details, raw, selection, and packet panes; split pane bodies next',
    },
  ],
  [
    'apps/netscli-cli/src/args.rs',
    {
      maxLines: 360,
      reason: 'Clap command surface; split command argument groups next',
    },
  ],
  [
    'apps/netscli-gui/src-tauri/src/commands/operations.rs',
    {
      maxLines: 350,
      reason: 'Tauri operation adapters; split scan/lookup/capture commands next',
    },
  ],
  [
    'apps/netscli-cli/src/tui/state/render/input.rs',
    {
      maxLines: 345,
      reason: 'TUI input rendering; split mode renderers next',
    },
  ],
  [
    'apps/netscli-gui/e2e/tauri-render/scenarios/helpers/menu.mjs',
    {
      maxLines: 345,
      reason: 'render automation menu helpers; split menu/dialog helpers next',
    },
  ],
  [
    'apps/netscli-gui/src/App.tsx',
    {
      maxLines: 345,
      reason: 'top-level GUI composition; continue extracting shell wiring next',
    },
  ],
  [
    'apps/netscli-cli/src/tui/state/mod.rs',
    {
      maxLines: 335,
      reason: 'TUI state facade; split state families next',
    },
  ],
  [
    'apps/netscli-gui/src/components/results/ResultTable.tsx',
    {
      maxLines: 335,
      reason: 'table selection/resize/keyboard behavior; split hooks next',
    },
  ],
  [
    'apps/netscli-cli/src/tui/runtime/input.rs',
    {
      maxLines: 330,
      reason: 'TUI input runtime; split command/key families next',
    },
  ],
  [
    'site/src/scripts/changelog-page.ts',
    {
      maxLines: 760,
      reason: 'changelog markdown renderer; split parser/render/timeline next',
    },
  ],
  [
    'site/src/scripts/docs-header.ts',
    {
      maxLines: 360,
      reason: 'docs header/search/toc behaviors; split search vs toc vs tables next',
    },
  ],
  [
    'site/src/scripts/landing-page.ts',
    {
      maxLines: 310,
      reason: 'landing interactions; split metrics/copy/lightbox/install next',
    },
  ],
  [
    'site/src/styles/starlight/20-docs-shell-closeout.css',
    {
      maxLines: 320,
      reason:
        'single cohesive docs shell close-out pass split from starlight.css; not further split to avoid fragmenting one cascade-ordered concern',
    },
  ],
]);
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
  'site/src',
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
      const relativeFile = path.relative(repoRoot, file).replaceAll(path.sep, '/');
      const exception = transitionExceptions.get(relativeFile);
      if (exception && lineCount <= exception.maxLines) {
        continue;
      }
      oversized.push({
        lines: lineCount,
        file: relativeFile,
        reason: exception
          ? `transition cap ${exception.maxLines} exceeded: ${exception.reason}`
          : 'no transition exception',
      });
    }
  }
}

if (oversized.length > 0) {
  oversized.sort((a, b) => b.lines - a.lines);
  console.error(`Files over ${maxLines} lines:`);
  for (const item of oversized) {
    console.error(`  ${item.lines.toString().padStart(4)}  ${item.file} (${item.reason})`);
  }
  process.exitCode = 1;
}
