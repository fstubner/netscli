# Landing page

Static site that GitHub Pages serves for this project. The deploy
workflow lives at `.github/workflows/pages.yml`.

## What's here

- `index.html` — the landing page itself. Plain HTML, one `<style>` block,
  one `<script>` block. No build step, no framework, no node_modules.
  Opens directly in a browser if you double-click it during development.

## How the download count works

There's no backend. The stats at the top of the page are pulled from the
public GitHub REST API at page load:

- `GET /repos/{owner}/{repo}/releases` → sums `download_count` across all
  release assets.
- `GET /repos/{owner}/{repo}` → reads `stargazers_count`.

If the user is rate-limited (unauthenticated API calls get 60/hour per
IP), the requests fail and the `—` placeholders stay visible. We never
show "0 downloads" — it's always either a real number or a dash.

For more accurate server-side stats, see the Analytics section below.

## Analytics

The head of `index.html` ships with an active **Cloudflare Web
Analytics** beacon. The token is safe to commit — it's an identifier,
not a credential. View traffic at:

<https://dash.cloudflare.com/?to=/:account/web-analytics>

Cloudflare Web Analytics is free with unlimited pageviews, sets no
cookies, and needs no consent banner in most jurisdictions.

**To re-point the beacon at a different site** (e.g. if this landing
page is forked into another project), create a new site in the
Cloudflare dashboard and replace the `data-cf-beacon` token on the
`<script>` tag near the top of `index.html`.

### Alternatives

If you'd rather use something else, swap the `<script>` tag for one of
these. They all work the same way — single beacon, no build step:

| Option | Hosting | Free tier |
|---|---|---|
| [Plausible](https://plausible.io) | SaaS (EU) | 30-day trial, then paid |
| [Umami](https://umami.is) | Self-host or cloud | Cloud has free tier |
| [GoatCounter](https://goatcounter.com) | SaaS | Free for non-commercial |
| [Fathom](https://usefathom.com) | SaaS | 7-day trial, then paid |
| [Vercel Analytics](https://vercel.com/analytics) | SaaS | Requires Vercel deploy |

All of the above are cookie-free and don't need a consent banner. Google
Analytics does and isn't listed — you can still drop in its `<script>`
tag the same way if you insist.

## Using this as a template for other projects

This was scaffolded to be trivially extractable. To reuse:

1. Copy `site/index.html` and `.github/workflows/pages.yml` to the new
   repo.
2. Search-and-replace the repo name (`fstubner/netscli`) and project name
   (`netscli`) in `index.html`. There are ~6 places.
3. Replace the tagline, install blocks, and "Try it" blocks with the new
   project's content.
4. In the new repo's **Settings → Pages**, set Source to "GitHub
   Actions".
5. Push to main; GitHub Actions deploys it.

If you find yourself doing this more than twice, convert this whole
directory into a proper GitHub Template Repository (the button on the
repo settings page). Then "Use this template" creates a new project with
the scaffolding already in place.
