// The hero block's shape, split out of types.ts.
//
// Not a judgement about the hero being special: types.ts was 328 lines against
// a 300-line guard once the comparison table's types landed, and this was the
// largest self-contained run of them. feedback-types.ts named the comparison
// types as the next candidate; they are 14 lines and would not have cleared
// the guard on their own, so they stayed and the hero moved instead.
//
// `Platform` still lives in types.ts. The import back is type-only and erased
// at compile time, so the cycle is a spelling detail rather than a runtime one.

import type { Platform } from './types';
import type { Visual } from './visual-types';

/** The hero's two command rows, per platform. */
export type HeroCommands = Record<
  Platform,
  {
    /** Package-manager line, for the narrower row. */
    packageManager: string;
    /** Install one-liner, for the wide row beside the download button. */
    script: string;
  }
>;

/** One installer in the hero's Desktop app menu.
 *
 *  The list is content, not markup: a product with no desktop build leaves
 *  `heroDownloads` empty and the button, its caption and the menu are not
 *  rendered at all. */
export interface HeroDownload {
  /** Which platform this installer is for. Drives both the platform glyph
   *  and which entry a visitor on that platform is offered by default. */
  os: Platform;
  /** Platform name as shown in the menu ("Windows", "Debian / Ubuntu"). */
  name: string;
  /** Architecture or variant line under the name ("Apple silicon"). */
  meta: string;
  /** File extension badge on the right of the row ("msi", "AppImage"). */
  ext: string;
  href: string;
  /** Caption inside the main button when this entry is the chosen one.
   *  Says the platform and the file out loud, e.g. "Windows · .msi
   *  installer" — a caption naming a different file from the one the
   *  button fetches is worse than no caption, so the two move together. */
  cue: string;
  /** The entry offered to a visitor detected on this `os`. Exactly one
   *  entry per os that appears in the list should set it; the first entry
   *  for that os is used if none does. */
  preferred?: boolean;
  /** Offered instead of `preferred` when the browser reports an arm64
   *  machine. macOS only in practice: the Intel build runs everywhere via
   *  Rosetta, so it stays the default and this is an upgrade. */
  appleSilicon?: boolean;
}

export interface Hero {
  /** Small uppercase strip above the headline. Also the server-rendered
   *  fallback when `releaseLink` is set and the release lookup fails. */
  badge: string;
  /** Turns the badge into a link to the release notes, and lets the page
   *  replace its text with the latest released version once GitHub confirms
   *  one (`v0.3.1 · What changed →`). Omit it and the badge stays the static
   *  string above, which is the default for a product with no changelog page
   *  or no published releases. */
  releaseLink?: string;
  heading: string;
  subhead: string;
  /** Shell command shown in the hero's highlighted install block. */
  /** The prominent hero command. Swapped per-OS at runtime by os-tabs.ts;
   *  this is what a visitor sees before that runs, and what a crawler sees. */
  quickInstall: string;
  /** The smaller command under it — a genuinely different route, never a
   *  restatement of the one above. Leave it empty for a product with one
   *  command: the row then holds only the link to the install section. */
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
  /** Any visual kind -- see visual-types.ts -- shown in place of the
   *  heroImage fields above when set. */
  visual?: Visual;
  /** Link to the source repo for the "View source" pill, the footer and the
   *  structured data. */
  sourceUrl: string;
  /** Set false to leave the "View source" link out of the hero, for a site
   *  whose nav already links the repo. The URL above is still used
   *  everywhere else. Defaults to true. */
  showSourceLink?: boolean;
  /** Label on the desktop-download button. Only rendered when
   *  `heroDownloads` has entries. */
  downloadLabel: string;
  /** Accessible name of the button that opens the installer menu. */
  downloadMenuLabel: string;
}

