import type { LandingSection } from './types';

// Which sections the landing page renders, in order.
//
// The four are independent: each reads its own content file and none assumes
// what sits above it. So a product with no install story drops 'install'
// rather than filling it with something weak, and one whose visitors ask
// questions before they read features can put 'faq' second.
//
// A name that appears twice renders twice; a name whose content is empty
// renders nothing. Dropping the last section is fine -- the footer is not in
// this list, and neither is the nav.
export const sections: LandingSection[] = ['hero', 'surfaces', 'install', 'faq'];
