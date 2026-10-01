export interface Meta {
  domain: string;
  title: string;
  description: string;
  ogDescription?: string;
  keywords: string;
  siteName: string;
  author: { name: string; url: string };
  ogImage: string;
  faviconPath: string;
  themeColor: string;
}

export interface Branding {
  wordmark?: string;
  wordmarkAlt: string;
  accentGradient: string;
  bg: string;
  fg: string;
}

export interface Hero {
  badge: string;
  heading: string;
  subhead: string;
  proof: string[];
  quickInstall: string;
  installLinkLabel: string;
  heroImage?: string;
  heroImageAlt?: string;
  heroImageWidth?: number;
  heroImageHeight?: number;
  heroImageWebp?: string;
  sourceUrl: string;
}

export interface SectionCopy {
  heading: string;
  leadHtml: string;
}

export interface WorkflowStep {
  label: string;
  title: string;
  body: string;
}

export interface SurfaceCard {
  title: string;
  body: string;
  image?: {
    src: string;
    webp?: string;
    alt: string;
    width: number;
    height: number;
  };
  codeHtml?: string;
  flip?: boolean;
}

export interface InstallEntry {
  label: string;
  command: string;
  hint?: string;
}

export interface FaqItem {
  q: string;
  a: string;
  aHtml?: string;
}

export interface BuiltWithEntry {
  name: string;
  url: string;
}

export interface Analytics {
  cloudflareToken?: string;
}

export interface SiteData {
  meta: Meta;
  branding: Branding;
  hero: Hero;
  copy: {
    workflow: SectionCopy;
    surfaces: SectionCopy;
    install: SectionCopy;
    faq: SectionCopy;
  };
  workflow: WorkflowStep[];
  surfaces: SurfaceCard[];
  install: {
    entries: InstallEntry[];
    tryCommands: string[];
    binariesNote: string;
  };
  faq: FaqItem[];
  builtWith: BuiltWithEntry[];
  analytics: Analytics;
  version: string;
}

const REPO = 'fstubner/xtctx';
const REPO_URL = `https://github.com/${REPO}`;

export const site: SiteData = {
  meta: {
    domain: 'https://xtctx.com',
    title: 'xtctx - Move between coding agents without starting over',
    description:
      'xtctx writes local MCP config and managed instructions so AI coding tools can read recent transcript sessions from the current repo.',
    ogDescription:
      'Local setup, status, skill sync, and MCP transcript retrieval for AI coding tools.',
    keywords:
      'mcp server, model context protocol, ai coding agents, synced skills, claude code, cursor, codex, google antigravity, opencode, local transcripts, cross tool handoff, semantic transcript search',
    siteName: 'xtctx',
    author: { name: 'Felix Stubner', url: 'https://github.com/fstubner' },
    ogImage: 'https://xtctx.com/favicon.svg',
    faviconPath: '/favicon.svg',
    themeColor: '#0a1424',
  },

  branding: {
    wordmarkAlt: 'xtctx',
    accentGradient: 'linear-gradient(90deg,#e8dfc8,#e8b878)',
    bg: '#0a1424',
    fg: '#e8dfc8',
  },

  hero: {
    badge: 'Local transcript retrieval for AI coding tools',
    heading: 'Keep project context portable across coding tools.',
    subhead:
      'Move between supported coding agents without starting over. xtctx indexes the transcript files your tools already write and serves them over MCP, so the next agent can pick up recent context. Install the plugin once to reach the tools everywhere, then opt each project in with a single setup command.',
    proof: ['One command per project', 'Local by default', 'Five MCP tools'],
    quickInstall: 'claude plugin marketplace add fstubner/xtctx && claude plugin install xtctx@xtctx',
    installLinkLabel: 'Get started',
    sourceUrl: REPO_URL,
  },

  copy: {
    workflow: {
      heading: 'How a handoff travels',
      leadHtml:
        'xtctx is not a dashboard or memory layer. It is MCP retrieval against transcript files your tools already write, with optional project wiring that delivers the handoff without the agent asking.',
    },
    surfaces: {
      heading: 'What setup writes',
      leadHtml:
        'The plugin writes nothing into your project. Running setup adds config, managed instructions, selected skill targets, and a rebuildable SQLite cache. Raw transcript files remain the source of truth.',
    },
    install: {
      heading: 'Install, then check',
      leadHtml:
        'The plugin gets you the MCP tools in every project. Add setup where you want the handoff delivered automatically, and use status to check what is wired.',
    },
    faq: {
      heading: 'Questions before using it in a repo',
      leadHtml: 'Short answers about setup, local storage, transcript limits, and what xtctx does not do.',
    },
  },

  workflow: [
    {
      label: '01',
      title: 'Install xtctx',
      body:
        'The plugin registers the MCP server and the handoff skill and writes nothing into your project. Run setup instead, or as well, to add managed instruction blocks and per-tool MCP config. Copilot CLI still requires --global-mcp.',
    },
    {
      label: '02',
      title: 'Open another tool',
      body:
        'The tool starts xtctx over stdio as an MCP server. With setup run, it also reads the managed instructions and receives the handoff without asking for it.',
    },
    {
      label: '03',
      title: 'Read recent sessions',
      body:
        'MCP calls list sessions, open raw transcript messages, and search chronological transcript windows.',
    },
    {
      label: '04',
      title: 'Check status',
      body:
        'Status reports configured tools, selected skills, transcript freshness, and unsupported targets.',
    },
  ],

  surfaces: [
    {
      title: 'Five MCP tools',
      body:
        'Agents can list recent sessions, open session detail, search transcript windows, check continuity status, and fetch a handoff manifest.',
      codeHtml: `<span class="dim">agent calls</span> xtctx_recent_sessions
<span class="dim">agent opens</span> xtctx_session_detail
<span class="dim">agent searches</span> xtctx_search_sessions
<span class="dim">agent checks</span> xtctx_continuity_status
<span class="dim">orchestrator reads</span> xtctx_handoff_manifest`,
    },
    {
      title: 'Managed setup files',
      body:
        'Setup owns generated instruction blocks, MCP config, and selected skill targets so the repo wiring is repeatable.',
      flip: true,
      codeHtml: `<span class="dim">$</span> <span class="cmd-text">npx -y xtctx setup</span>
<span class="success-text">updated</span> .xtctx/config.yaml
<span class="success-text">updated</span> .xtctx/skills/xtctx-handoff/SKILL.md
<span class="success-text">updated</span> AGENTS.md
<span class="success-text">updated</span> .codex/config.toml
<span class="success-text">verified</span> MCP config`,
    },
    {
      title: 'Status output',
      body:
        'Status reports configured tools, transcript freshness, selected skills, managed blocks, and unsupported targets.',
      codeHtml: `<span class="dim">$</span> <span class="cmd-text">npx -y xtctx status</span>
<span class="info-text">MCP</span>      npx -y xtctx
<span class="info-text">Search</span>   keyword only. Semantic search is optional: run xtctx embeddings enable (downloads the local model and its runtime, about 540 MB on disk)
<span class="info-text">Data</span>     12 sessions, 1840 messages, 460 retrieval windows
<span class="info-text">Tools:</span>
  <span class="success-text">+</span> codex         detected; 7 sessions; hook: instruction-only
  <span class="success-text">+</span> claude-code   detected; 5 sessions; hook: executable`,
    },
    {
      title: 'Search stays local',
      body:
        'Raw transcript files remain the source of truth. SQLite is a rebuildable local index for ordered lookup and fallback keyword search.',
      flip: true,
      codeHtml: `<span class="info-text">cache</span> <span class="var-text">.xtctx/state/xtctx.db</span>
├── <span class="var-text">sessions</span>
├── <span class="var-text">messages</span>
├── <span class="var-text">retrieval_units</span>
├── <span class="var-text">retrieval_units_fts</span>
└── <span class="var-text">retrieval_unit_vectors</span>`,
    },
  ],

  install: {
    entries: [
      {
        label: 'Install the plugin',
        command: 'claude plugin marketplace add fstubner/xtctx && claude plugin install xtctx@xtctx',
        hint:
          'Registers the MCP server and the handoff skill machine-wide, and writes nothing into your project. The tools then reach every project; each one answers once it has been set up, and names the command until then. Codex, Copilot, Cursor and Antigravity install from the same marketplace; see the README for their commands.',
      },
      {
        label: 'Add project wiring',
        command: 'npx -y xtctx setup',
        hint:
          'Optional upgrade. Writes managed instruction blocks so the next agent receives the handoff without calling a tool, plus the SessionStart hook, per-tool MCP config, and skill sync. The only route for opencode.',
      },
      {
        label: 'Check what is wired',
        command: 'npx -y xtctx status',
        hint:
          'Reports configured tools, cached transcript freshness, skill drift, managed blocks, and repair hints.',
      },
      {
        label: 'Start MCP over stdio',
        command: 'npx -y xtctx',
        hint:
          'Starts the MCP server for clients. In a normal terminal it prints setup and status help.',
      },
    ],
    tryCommands: [
      'npx -y xtctx setup',
      'npx -y xtctx status',
      'npx -y xtctx --help',
    ],
    binariesNote:
      'Read the <a href="https://github.com/fstubner/xtctx#readme">README</a> for supported tools and local transcript notes.',
  },

  faq: [
    {
      q: 'What problem does xtctx solve?',
      a: 'It lets an AI coding tool read recent local transcript sessions from the current repo through MCP, including sessions from a different tool, so you can switch without re-explaining the work.',
    },
    {
      q: 'Do I need to run setup in every project?',
      a: 'Yes, once per project you want handoff in. The plugin makes the tools reachable everywhere, but a project that has not opted in has no index to read, so every tool answers with that and names `npx -y xtctx setup`. Setup also adds delivery: managed instruction blocks put the handoff in front of the next agent whether it calls a tool or not.',
    },
    {
      q: 'Does xtctx run a background service?',
      a: 'No. xtctx has no daemon, API server, dashboard, watcher, or web service. Each agent starts its own xtctx MCP server, which indexes when it starts and when it is called, and stops when the agent does.',
    },
    {
      q: 'Does xtctx sync skills?',
      a: 'The plugin ships the built-in xtctx-handoff skill. Setup additionally inventories compatible skills from connected tools and syncs selected project skills to each supported target in that tool’s native format.',
    },
    {
      q: 'Does it summarize sessions?',
      a: 'No. xtctx points agents to recent raw transcript messages. Those messages stay the source of truth.',
    },
    {
      q: 'What are the limits?',
      a: 'xtctx is local-only by default; sending window text to an external embedding endpoint is something a project has to opt into by hand. Transcript formats can change upstream, semantic search is an optional add-on (xtctx embeddings enable, about 540 MB on disk; the default install is about 55 MB and searches by keyword straight away), its vectors are built incrementally in the background, and search falls back to keyword while vectors are missing or the local model is unavailable.',
    },
    {
      q: 'Can I test it without private transcripts?',
      a: 'Yes. The public demo smoke creates synthetic Claude Code and Codex transcript stores in a temporary project, then calls the built MCP server over stdio.',
      aHtml:
        'Yes. The <a href="https://github.com/fstubner/xtctx/blob/main/docs/demo.md">public demo smoke</a> creates synthetic Claude Code and Codex transcript stores in a temporary project, then calls the built MCP server over stdio.',
    },
    {
      q: 'Which tools are supported?',
      a: 'Claude Code, Cursor, Codex, GitHub Copilot, Google Antigravity, opencode, and GitHub Copilot CLI.',
    },
    {
      q: 'Where does data live?',
      a: 'Project config lives in .xtctx/config.yaml. The rebuildable SQLite cache lives in .xtctx/state/xtctx.db. Source transcripts stay in each tool storage location.',
    },
    {
      q: 'Is it open source?',
      a: 'Yes. xtctx is MIT licensed and published at github.com/fstubner/xtctx.',
      aHtml:
        'Yes. xtctx is MIT licensed and published at <a href="https://github.com/fstubner/xtctx">github.com/fstubner/xtctx</a>.',
    },
  ],

  builtWith: [
    { name: 'Model Context Protocol', url: 'https://modelcontextprotocol.io/' },
    { name: 'SQLite', url: 'https://www.sqlite.org/' },
    { name: 'Astro', url: 'https://astro.build/' },
  ],

  analytics: {},

  version: '0.21.8', // x-release-please-version
};
