import { meta } from './meta';

/**
 * Where the install one-liners point.
 *
 * These are served BY THIS SITE, from src/pages/install.sh.ts and
 * src/pages/install.ps1.ts, which read the real scripts out of the repo at
 * build time. There is no second copy of either script to drift.
 *
 * The reason is length, not branding. The raw.githubusercontent.com form is
 * 91 characters -- 624px of monospace -- and the widest slot the hero can give
 * it is 351px, so the command a reader is meant to copy rendered as
 * `iwr -useb https://raw.githubusercont...`. Copy still worked; nothing about
 * the ellipsis said so. These are 46 and 47 characters and fit with room.
 *
 * Defined once because the same two URLs appear in the hero, the OS tab
 * script, the install section and twice in the FAQ. They were nine separate
 * literals.
 */
const base = meta.domain.replace(/\/$/, '');

export const INSTALL_SH_URL = `${base}/install.sh`;
export const INSTALL_PS1_URL = `${base}/install.ps1`;

/** `curl -fsSL https://netscli.com/install.sh | bash` */
export const INSTALL_SH_COMMAND = `curl -fsSL ${INSTALL_SH_URL} | bash`;

/** `iwr -useb https://netscli.com/install.ps1 | iex` */
export const INSTALL_PS1_COMMAND = `iwr -useb ${INSTALL_PS1_URL} | iex`;
