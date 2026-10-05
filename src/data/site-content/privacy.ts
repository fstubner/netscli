import type { PrivacyCopy } from './privacy-types';

// The privacy page (/privacy/). Sample content, like every other file in this
// directory, and check-content.mjs fails the build while REPLACE_ME is still
// here.
//
// Write it from the product, not from another policy. App stores ask for this
// URL, and their reviewers read it against what the app actually does. Go
// through what the product reads, what it keeps and where, and every
// connection it makes on its own (update checks, crash reports, analytics),
// then say the same for this website. If a claim cannot be checked against
// the code, it does not go in.
export const privacyCopy: PrivacyCopy = {
  heading: 'Privacy',
  leadHtml: 'REPLACE_ME: one or two sentences on what the product does and does not collect.',
  bodyHtml: `
<h2>What stays on your computer</h2>
<p>REPLACE_ME: what the product reads, and what it keeps and where.</p>

<h2>What reaches the internet</h2>
<ul>
  <li>REPLACE_ME: each connection the product makes on its own, and how to turn it off.</li>
</ul>

<h2>This website</h2>
<p>REPLACE_ME: hosting, analytics, and anything the pages fetch in the visitor's browser.</p>

<h2>Contact</h2>
<p>REPLACE_ME: where to send privacy questions.</p>
`,
};
