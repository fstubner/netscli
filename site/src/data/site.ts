// All project-specific content lives under site-content/. Fork the site
// and that's the directory you edit to retarget it at a different
// product. Every component reads the assembled `site` export from here.

import { branding, meta } from './site-content/meta';
import { hero, heroDownloads } from './site-content/hero';
import { surfaces, surfacesCopy } from './site-content/surfaces';
import {
  installBinariesNote,
  installByPlatform,
  installCopy,
  installFromSource,
  installNotes,
  tryCommands,
} from './site-content/install';
import { faq, faqCopy } from './site-content/faq';
import { analytics, builtWith, social } from './site-content/footer';
import { readProductVersion } from './site-content/version';
import type { SiteData } from './site-content/types';

export type {
  Analytics,
  Branding,
  BuiltWithEntry,
  FaqItem,
  Hero,
  HeroDownload,
  InstallEntry,
  Meta,
  Platform,
  SectionCopy,
  SiteData,
  SocialProof,
  SurfaceCard,
  SurfaceDownload,
  TryCommand,
} from './site-content/types';

export const site: SiteData = {
  meta,
  branding,
  hero,
  heroDownloads,
  copy: {
    surfaces: surfacesCopy,
    install: installCopy,
    faq: faqCopy,
  },
  surfaces,
  install: {
    byPlatform: installByPlatform,
    tryCommands,
    binariesNote: installBinariesNote,
    fromSource: installFromSource,
    notes: installNotes,
  },
  faq,
  builtWith,
  social,
  analytics,
  version: readProductVersion(),
};
