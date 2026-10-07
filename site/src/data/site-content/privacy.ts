import type { PrivacyCopy } from './privacy-types';

// The privacy page (/privacy/). Every claim here was checked against the code
// on 2026-10-07: the desktop app's history limit and settings, its GitHub
// release check, the CLI's history database, where DNS lookups go, and what
// the site loads. The 2026-10-04 check missed the public DNS fallback because
// it searched for HTTP clients and URLs, and the fallback was neither (see
// crates/netscli-core/src/dns/resolver.rs). Re-check before changing what any
// of them do, and check every way the code can reach the network, not only
// HTTP.
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
  <li>From version 0.3.5 on, the command line and terminal UI keep a history of their results in <code>~/.netscli/netscli.db</code> only if you set <code>NETSCLI_HISTORY=1</code>. Earlier versions kept every result there without asking. Deleting the file removes that history.</li>
  <li>The desktop app and terminal UI remember their settings.</li>
  <li>Exports and packet captures are written only where you choose to save them.</li>
</ul>

<h2>What reaches the internet</h2>
<ul>
  <li><strong>Scans go where you point them.</strong> A port scan, ping or trace contacts the hosts you ask it to. A DNS lookup, including the one a scan makes to turn a name into an address, goes only to the DNS servers your computer is set up to use.</li>
  <li><strong>Version 0.3.4 and earlier also asked Cloudflare's public DNS.</strong> When your DNS servers could not answer a lookup, including when a name simply had no records of the type asked for, those versions asked Cloudflare's public resolver (1.1.1.1) the same question, unencrypted. Single-word names and names ending in .local, .lan, .home, .home.arpa, .internal or .test were never sent. Setting <code>NETSCLI_DNS_FALLBACK=0</code> turns this off in those versions. From version 0.3.5 on, NetsCLI never does this.</li>
  <li><strong>The desktop app checks for new releases.</strong> Installs that can update themselves fetch one small file from GitHub's release downloads, and the rest ask GitHub's API for the latest release. Either way GitHub sees your IP address. You can turn the check off in Settings, under Release Notifications. If you choose to install an update, it is downloaded from GitHub Releases.</li>
  <li><strong>The command line, terminal UI and MCP server</strong> make no connections of their own beyond the operations you run.</li>
</ul>

<h2>This website</h2>
<p>This site is hosted on GitHub Pages behind Cloudflare, which handles every request to it and so sees your IP address. It uses Cloudflare Web Analytics, which counts page views without cookies and without identifying visitors. The landing page asks GitHub and crates.io for the star and download counts it shows, and the changelog page asks GitHub for the release notes. Your browser contacts those services directly.</p>

<h2>Contact</h2>
<p>Questions about privacy can go to the <a href="https://github.com/fstubner/netscli/issues">issue tracker</a>.</p>
`,
};
