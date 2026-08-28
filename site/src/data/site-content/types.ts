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
  /** Favicon + apple-touch-icon. */
  faviconPath: string;
  themeColor: string;
}

export interface Branding {
  /** Path to the wordmark image served from /. */
  wordmark: string;
  /** Shown in nav at 160px desktop / 132px mobile. */
  wordmarkAlt: string;
  /** Links + underline accent colour. */
  accentGradient: string;
  /** Background fill. */
  bg: string;
  /** Default body text colour. */
  fg: string;
}

export interface Hero {
  /** Small uppercase strip above the headline. */
  badge: string;
  heading: string;
  subhead: string;
  /** Shell command shown in the hero's highlighted install block. */
  /** The prominent hero command. Swapped per-OS at runtime by os-tabs.ts;
   *  this is what a visitor sees before that runs, and what a crawler sees. */
  quickInstall: string;
  /** The smaller command under it — a genuinely different route, never a
   *  restatement of the one above. */
  quickInstallAlt: string;
  /** Jump-to-install link label. */
  installLinkLabel: string;
  /** Path to the hero screenshot. */
  heroImage: string;
  heroImageAlt: string;
  /** Intrinsic pixel dimensions so the browser reserves layout space. */
  heroImageWidth: number;
  heroImageHeight: number;
  /** Optional WebP source for <picture>. */
  heroImageWebp?: string;
  /** Link to the source repo for the "View source" pill. */
  sourceUrl: string;
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
  /** If true, flips text and visual sides for alternating rhythm. */
  flip?: boolean;
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
  /** CLI + terminal UI (the `netscli` binary). */
  cli: InstallEntry[];
  /** Desktop GUI application. */
  desktop: InstallEntry[];
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

export interface SiteData {
  meta: Meta;
  branding: Branding;
  hero: Hero;
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
    tryCommands: TryCommand[];
    binariesNote: string;
  };
  faq: FaqItem[];
  builtWith: BuiltWithEntry[];
  social: SocialProof;
  analytics: Analytics;
  /** Version string published on crates.io / used in structured data. */
  version: string;
}
