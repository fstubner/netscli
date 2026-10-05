import type { PrivacyCopy } from './privacy-types';

// The privacy page (/privacy/). Every claim here was checked against the code
// on 2026-10-04: the desktop app's history limit and settings, its GitHub
// release check, the CLI's lack of outbound calls, and the site's analytics.
// Re-check before changing what any of them do.
export const privacyCopy: PrivacyCopy = {
  heading: 'Privacy',
  leadHtml:
    'NetsCLI has no accounts, no advertising and no telemetry. Nothing you scan is sent to the developer or to anyone else.',
  bodyHtml: `
<h2>What stays on your computer</h2>
<p>NetsCLI reads information about your local network to do its job. That includes IP addresses, MAC addresses and the maker they belong to, hostnames, open ports, and the greetings services send back. It is shown to you and is not uploaded anywhere.</p>
<p>Some of it is kept on your computer.</p>
<ul>
  <li>The desktop app can keep your 20 most recent runs, with their results, so you can reopen them. Clearing history removes them.</li>
  <li>The desktop app and terminal UI remember their settings.</li>
  <li>Exports and packet captures are written only where you choose to save them.</li>
</ul>

<h2>What reaches the internet</h2>
<ul>
  <li><strong>Scans go where you point them.</strong> A port scan, ping, trace or DNS lookup contacts the hosts and DNS servers you ask it to, the same as any network tool.</li>
  <li><strong>The desktop app checks for new releases.</strong> It asks GitHub's API for the latest release, which shares your IP address with GitHub. You can turn the check off in Preferences. If you choose to install an update, it is downloaded from GitHub Releases.</li>
  <li><strong>The command line, terminal UI and MCP server</strong> make no connections of their own beyond the operations you run.</li>
</ul>

<h2>This website</h2>
<p>This site is hosted on GitHub Pages and uses Cloudflare Web Analytics, which counts page views without cookies and without identifying visitors. The landing page asks GitHub and crates.io for the star and download counts it shows, so your browser contacts both.</p>

<h2>Contact</h2>
<p>Questions about privacy can go to the <a href="https://github.com/fstubner/netscli/issues">issue tracker</a>.</p>
`,
};
