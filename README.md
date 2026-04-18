# Landing page

Astro site that GitHub Pages serves for this project. The deploy
workflow lives at `.github/workflows/pages.yml`.

Everything project-specific lives in `src/data/site.ts`. Fork the site
into another repo and that's the one file you edit to retarget the
landing at a different product — title, description, install commands,
FAQ, surface cards, screenshots, built-with stack, version.

## Layout

```
site/
├── astro.config.mjs          — canonical site URL
├── package.json              — astro dep, npm scripts
├── tsconfig.json             — extends astro/tsconfigs/strict
├── public/                   — static passthrough (favicon, CNAME, images…)
├── src/
│   ├── data/site.ts          — all project-specific content
│   ├── styles/global.css     — theme + layout + section styles
│   ├── layouts/Page.astro    — meta, OG, JSON-LD schema
│   ├── components/*.astro    — Nav, Hero, Surfaces, Install, Faq, Footer
│   └── pages/index.astro     — page composition + client script
└── dist/                     — build output (gitignored)
```

## Local development

```bash
cd site
npm install
npm run dev        # http://localhost:4321 with HMR
npm run build      # static output into dist/
npm run preview    # serve dist/
```

Node 18+ is required. Astro 5.

## How the download count works

There's no backend. The stats at the top of the page are pulled from
the public GitHub REST API on page load:

- `GET /repos/{owner}/{repo}` → reads `stargazers_count`.
- `GET /repos/{owner}/{repo}/releases` → sums `download_count` across
  all release assets.

The repo slug comes from `site.social.repo` in `src/data/site.ts`.

If the user is rate-limited (unauthenticated API calls get 60/hour per
IP), the requests fail silently and the em-dash placeholders stay
visible. We never show "0 downloads" — it's always either a real
number or a dash.

## Analytics

`src/data/site.ts` → `analytics.cloudflareToken` controls the
Cloudflare Web Analytics beacon. Set to a string token to enable, or
remove the property to disable.

Cloudflare Web Analytics is free with unlimited pageviews, sets no
cookies, and needs no consent banner in most jurisdictions.

### Other analytics options

All of the following work the same way — single beacon, no build
step. Swap the Cloudflare beacon in `src/layouts/Page.astro` for
whichever you prefer:

| Option | Free tier |
|---|---|
| [Plausible](https://plausible.io) | 30-day trial, then paid |
| [Umami](https://umami.is) | Cloud has free tier |
| [GoatCounter](https://goatcounter.com) | Free for non-commercial |
| [Fathom](https://usefathom.com) | 7-day trial, then paid |

None of these set cookies or need a consent banner in most
jurisdictions. Google Analytics does; it isn't listed for that
reason.

## Using this as a template for other projects

The Astro scaffold was designed to be trivially retargetable:

1. Copy the entire `site/` directory to the new repo.
2. Edit `src/data/site.ts` — name, description, install commands,
   FAQ items, surface cards, built-with list, GitHub repo slug.
3. Replace images in `public/` (`gui-dashboard.png`, the screenshots,
   and the wordmark at `public/assets/netscli-wordmark.png`).
4. If the product isn't software, edit
   `src/layouts/Page.astro` to swap the `SoftwareApplication`
   schema for whatever's more appropriate (`Product`, `WebSite`, …).
5. Copy `.github/workflows/pages.yml` and update the `Settings →
   Pages` source to "GitHub Actions".

If you find yourself doing this more than twice, extract `site/` into
its own GitHub Template Repository (the button on the repo settings
page). Then "Use this template" creates a new project with the
scaffolding already in place and no fork relationship to maintain.
