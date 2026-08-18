/* The site navigation, defined once.
 *
 * Three components render this nav: the landing bar (components/Nav.astro),
 * the docs bar (components/starlight/Header.astro), and the docs mobile menu
 * (components/starlight/MobileMenuFooter.astro). Each used to carry its own
 * copy of the list, in a different shape, with its own `isActive`. They had
 * drifted: six links on the landing bar, five in the docs bar, six split
 * across two groups in the mobile menu, so GitHub appeared on the landing
 * page and in the mobile menu but not in the docs bar.
 *
 * Anchor targets are stored as `section`, not as a finished href, because the
 * correct link depends on where you are: `#install` on the landing page,
 * `/#install` anywhere else. `hrefFor` does that; do not hard-code either
 * form.
 */

export interface NavLink {
  label: string;
  /** Set for links to another page. Mutually exclusive with `section`. */
  href?: string;
  /** Landing-page section id. Mutually exclusive with `href`. */
  section?: string;
  external?: boolean;
  /** Which heading this sits under in the docs mobile menu, which is the one
   *  place the nav is grouped. The flat bars ignore it. */
  mobileGroup: 'site' | 'project';
}

export const navLinks: NavLink[] = [
  { label: 'Features', section: 'surfaces', mobileGroup: 'site' },
  { label: 'Install', section: 'install', mobileGroup: 'site' },
  { label: 'FAQ', section: 'faq', mobileGroup: 'site' },
  { label: 'Docs', href: '/docs/', mobileGroup: 'site' },
  { label: 'Changelog', href: '/changelog/', mobileGroup: 'project' },
  {
    label: 'GitHub',
    href: 'https://github.com/fstubner/netscli',
    external: true,
    mobileGroup: 'project',
  },
];

/** Resolve a link's href for the page currently being rendered. */
export function hrefFor(link: NavLink, pathname: string): string {
  if (link.href) return link.href;
  return pathname === '/' ? `#${link.section}` : `/#${link.section}`;
}

/** How `link` relates to the page currently being rendered, as the ARIA
 *  value to put on it -- or undefined when it is neither.
 *
 * `page` is reserved for the exact page. A link to a section that merely
 * contains it gets `true`, which is the ARIA value for "current within this
 * set" and does not claim to be the page.
 *
 * The distinction is not cosmetic. This used to prefix-match and return the
 * same value for both, so on /docs/install/ the Starlight sidebar marked
 * "Installation" as the current page and the "Docs" link here marked itself
 * as the current page too. Two elements claiming aria-current="page" on one
 * document makes a screen reader announce "current page" twice, for two
 * different destinations.
 *
 * Section links are never current here -- on the landing page the scroll spy
 * in scripts/site-nav.ts marks those with "location". */
export function isCurrent(link: NavLink, pathname: string): 'page' | 'true' | undefined {
  if (!link.href || link.external) return undefined;
  // Trailing-slash-stripped, so this does not depend on which convention the
  // router hands us.
  const here = pathname.replace(/\/$/, '');
  const base = link.href.replace(/\/$/, '');
  if (here === base) return 'page';
  return here.startsWith(`${base}/`) ? 'true' : undefined;
}
