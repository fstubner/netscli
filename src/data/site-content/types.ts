// Feedback's types live in ./feedback-types, and are re-exported here so an
// import of either path keeps working. types.ts crossed the 300-line file-size
// guard when the feedback feature landed (302, measured 2026-09-21 on the first
// CI run after the runner came back), and the guard's exception map is for
// transitions with a named next step rather than for carrying a file over.
export type { Feedback, FeedbackPlacement, FeedbackRoute } from './feedback-types';
import type { Feedback } from './feedback-types';

// The hero's types live in ./hero-types and are re-exported the same way, for
// the same reason: the comparison table's types took this file to 328.
export type { Hero, HeroCommands, HeroDownload } from './hero-types';
import type { Hero, HeroCommands, HeroDownload } from './hero-types';

// The shared picture-slot type; see ./visual-types.
export type {
  AgentSession,
  AgentSessionVisual,
  AgentTurn,
  CodeVisual,
  ImageVisual,
  TerminalVisual,
  Visual,
} from './visual-types';
import type { Visual } from './visual-types';

// Shared type definitions for the site content modules under
// site/src/data/site-content/. Assembled into the public `SiteData` shape
// by site/src/data/site.ts — that's the only module other files should
// import `site` from.

export interface Meta {
  /** Canonical site URL without trailing slash. */
  domain: string;
  /** <title> */
  title: string;
  /** <meta name="description"> */
  description: string;
  /** Short form used in OG / Twitter cards. Falls back to description. */
  ogDescription?: string;
  /** Site name for OG. */
  siteName: string;
  author: { name: string; url: string };
  /** Absolute URL to the OG/Twitter share image. */
  ogImage: string;
  /** What the share image shows, for the `twitter:image:alt` tag. Every
   *  page's card uses the same asset, so one description covers them all. */
  ogImageAlt: string;
  /** Favicon + apple-touch-icon. */
  faviconPath: string;
  themeColor: string;
}

/** A comparison column. `highlight` marks this product's, which is tinted. */
export interface ComparisonColumn {
  name: string;
  highlight?: boolean;
}

/** A capability row. `cells` is one per column, in order: '✓', '—', or a word. */
export interface ComparisonRow {
  feature: string;
  cells: string[];
}

/** schema.org SoftwareApplication facts, required so a new site answers them.
 *  As literals in the JSON-LD one site advertised the wrong language for its
 *  own program. `programmingLanguage` is the PRODUCT's, not the site's. */
export interface AppSchema {
  applicationCategory: string;
  applicationSubCategory: string;
  operatingSystem: string;
  license: string;
  programmingLanguage: string;
  /** Price as a string. '0' for free. */
  price: string;
  priceCurrency: string;
}

export interface Branding {
  /** Wordmark served from /. Used on dark, and on both without a light one. */
  wordmark: string;
  /** Optional light-theme wordmark. Lettering must be light on the dark bar
   *  and dark on the light one, so a mark with type needs two files. Omit it
   *  and `--ui-mark-filter` handles the light theme instead. */
  wordmarkLight?: string;
  /** Shown in nav at 160px desktop / 132px mobile. */
  wordmarkAlt: string;
  /** Links + underline accent colour. */
  accentGradient: string;
  /** Background fill. */
  bg: string;
  /** Default body text colour. */
  fg: string;
}

export interface SurfaceCard {
  title: string;
  /** HTML allowed — typically short paragraph, may contain <code>. */
  body: string;
  /** If set, renders an image panel. */
  image?: {
    src: string;
    webp?: string;
    alt: string;
    width: number;
    height: number;
  };
  /** If set instead of image, renders a stylised code block. HTML allowed. */
  codeHtml?: string;
  /** Any visual kind -- see visual-types.ts. Takes the place of `image`
   *  and `codeHtml` when set; those two stay for sites written before it. */
  visual?: Visual;
  /** If true, flips text and visual sides for alternating rhythm. */
  flip?: boolean;
  /** Text above, visual across the full content width, instead of side by
   *  side. For a visual that needs the room -- an agent session's three
   *  panes -- and ignores `flip`. */
  wide?: boolean;
  /** Optional per-platform download buttons rendered below the body.
   *  Used by the Desktop card to surface .msi / .dmg / .deb / .AppImage
   *  installers from the latest GitHub release. */
  downloads?: SurfaceDownload[];
}

export interface SurfaceDownload {
  /** Visible button label, e.g. "Windows (.msi)". */
  label: string;
  /** Direct download URL. Use the /releases/latest/download/ form so
   *  the buttons auto-track the latest release without site updates. */
  url: string;
  /** Optional secondary line below the label, e.g. "Apple Silicon". */
  hint?: string;
}

export type Platform = 'windows' | 'macos' | 'linux';

export interface InstallEntry {
  label: string;
  /** Shell command(s) shown monospace with copy button. Omit when this
   *  entry is a direct download — set `href` instead. */
  command?: string;
  /** Direct download URL. Entries with an `href` render as a link rather
   *  than a copyable command, for the installer artifacts that have no
   *  package-manager equivalent (.msi / .dmg / .deb / .AppImage). */
  href?: string;
  /** Optional small hint, rendered under the label. Used to warn about
   *  the unsigned installers before someone hits a Gatekeeper or
   *  SmartScreen dialog with no explanation. */
  hint?: string;
}

/** Install routes for one OS, split by which thing you are installing.
 *
 *  Both lists follow the same convention as before: position 0 is the
 *  recommended entry and renders as the hero card; the rest render as
 *  alternative rows in array order.
 */
export interface PlatformInstall {
  /** Command-line routes: the binary itself, however it is installed. */
  cli: InstallEntry[];
  /** Desktop application routes. Leave empty for a product with no
   *  desktop build; the section renders without that column. */
  desktop: InstallEntry[];
}

/** One client in the install grid; see install-clients.ts. */
export interface InstallClient {
  /** The client as its users call it: "Claude Code", "VS Code". */
  name: string;
  /** Under the name, so a visitor can tell what the client is without its
   *  logo -- most vendors do not allow a third party to show theirs. Who
   *  makes it and what kind of tool it is: "Anthropic · terminal agent". */
  maker?: string;
  /** Drawn as a glyph beside the name; see install-types.ts. */
  kind?: import('./install-types').InstallClientKind;
  /** Commands, in order, each with its own copy button. Empty for a client
   *  whose route has no command -- say what to do in `note` instead. */
  commands: string[];
  /** One line under the commands: a caveat, or the route when there is no
   *  command. Plain text. */
  note?: string;
}

export interface TryCommand {
  /** Short comment rendered above the command. */
  comment: string;
  /** Shell command copied by the row-level copy button. */
  command: string;
}

export interface FaqItem {
  group: string;
  q: string;
  /** Plain text used verbatim in both the visible section and JSON-LD. */
  a: string;
  /** Rich HTML variant for the visible section. Falls back to `a`. */
  aHtml?: string;
}

export interface BuiltWithEntry {
  name: string;
  url: string;
}

export interface SocialProof {
  /** GitHub repo in "owner/name" format. Used to fetch stars + download counts. */
  repo: string;
  /**
   * crates.io crate name, when the product is installable with `cargo install`.
   * Its all-time downloads are added to the GitHub release-asset total, because
   * a cargo install never touches a release asset and the label says "total".
   * Omit for a product that is not on crates.io: the fetch is then skipped and
   * the total comes from GitHub alone.
   *
   * Name only the crate people install. Library crates alongside it are
   * dependency resolution and docs.rs builds rather than installs, and counting
   * them reports one `cargo install` several times.
   */
  cratesIoCrate?: string;
}

export interface Analytics {
  /** Cloudflare Web Analytics beacon token. Omit to disable. */
  cloudflareToken?: string;
}

export interface SectionCopy {
  heading: string;
  /** HTML allowed — typically short tagline with an anchor link. */
  leadHtml: string;
}

export interface Modules {
  /** Whether the /docs/ Starlight section exists for this product. When
   *  false, nav/footer/404 stop linking to /docs/ and in-copy "Full docs →"
   *  references are omitted — but the Starlight integration itself must
   *  also be removed from astro.config.mjs (see the comment there). */
  docs: boolean;
  /** Whether the /changelog/ page exists for this product. When false,
   *  nav/footer stop linking to /changelog/. */
  changelog: boolean;
}

/** How the landing page arranges its hero and the rhythm below it. */
export type LandingLayout = 'centered' | 'split';

/** A section the landing page can render. Adding one here means adding a
 *  component for it in src/pages/index.astro's map. */
export type LandingSection = 'hero' | 'surfaces' | 'compare' | 'install' | 'faq';

/** One group in the docs sidebar, as Starlight expects it. */
export interface DocsSection {
  label: string;
  items: { label: string; link: string }[];
}

export interface SiteData {
  meta: Meta;
  branding: Branding;
  modules: Modules;
  hero: Hero;
  /** Desktop installers offered in the hero. Empty for a product that
   *  ships no desktop build. */
  heroDownloads: HeroDownload[];
  /** Visible headings + leads for each main section. */
  copy: {
    surfaces: SectionCopy;
    install: SectionCopy;
    faq: SectionCopy;
  };
  surfaces: SurfaceCard[];
  install: {
    /** Per-OS install routes, each split into CLI and desktop groups. */
    byPlatform: Record<Platform, PlatformInstall>;
    /** Install routes per client. When non-empty the install section shows
     *  these as a grid of cards instead of the per-OS tabs. */
    clients: InstallClient[];
    /** Numbers the by-client layout's two steps; see install-types.ts. */
    steps?: import('./install-types').InstallSteps;
    tryCommands: TryCommand[];
    binariesNote: string;
    /** Build-from-source command, listed in /llms.txt after the quickstart. */
    fromSource: string;
    /** Caveats /llms.txt prints under the install list, one line each. */
    notes: string[];
  };
  faq: FaqItem[];
  feedback: Feedback;
  builtWith: BuiltWithEntry[];
  social: SocialProof;
  analytics: Analytics;
  /** Version string published on crates.io / used in structured data. */
  version: string;
}
