# Styles

Two tiers, and the seam between them is what makes this usable as a
template: the docs shell and the landing page share a palette and nothing
else.

```
tokens.css           shared: brand palette, base ramp, nav height, wordmark
code-surface.css     shared: the dark surface code sits on, in both themes
theme-control.css    shared: the light/dark/system control both bars draw
docs/                the Starlight docs shell, one file per region
landing/tokens.css   the landing page's character: chips, bands, on-dark ink,
                     elevation, and the subtree remaps that use them
landing/base.css     the landing page's page-level rules: box model, body,
                     section rhythm, buttons, the dark bands, copy buttons
landing/lightbox.css the image lightbox the surfaces section opens
```

The docs load `tokens.css`, `docs/*`, `theme-control.css` and
`code-surface.css` through `customCss` in `astro.config.mjs`. The landing
page loads `tokens.css`, `code-surface.css`, `landing/*` and
`theme-control.css` through `layouts/Page.astro`. Neither loads the other's
tier, and `scripts/css-equivalence.mjs --stack landing|docs` checks each
against its own pages.

## To re-theme a project

1. `tokens.css` -- the accent, the greys, the surfaces. Both halves follow.
2. `docs/theme.css` -- how Starlight's own tokens map onto that palette.
3. Nothing else, unless the code surface should change too
   (`code-surface.css`).

## To give the landing page a different character

`landing/tokens.css` first (the bands, chips and elevation are all tokens
there), then `landing/base.css` for section rhythm and buttons, then the
components. The components in `components/*.astro` are data-driven from
`data/site-content/` and each carries its own `<style is:global>` block,
so a section like the FAQ moves to another project by copying the
component and its content file. Two caveats, measured on this codebase:

- Their styles are global, not scoped: a component may style another's
  class and nothing stops it. The one case found (`.surface-visual img` in
  Hero) was moved to Surfaces; keep it that way.
- They still carry some literal colours -- 14 in Install, 11 in Hero, 8 in
  Nav, 4 in Surfaces, most of them rgba() greys -- so a re-theme that goes
  beyond the accent will visit those. `grep -nE "#[0-9a-f]{3,8}\b|rgba?\(" `
  over `components/*.astro` lists them.

## Checking a change

`docs/README.md` has the full workflow; in short: `npm run build`, then
`node scripts/css-equivalence.mjs --old origin/main --stack <docs|landing>`
for the cascade, then `node scripts/visual-snapshot.mjs check` for the
pixels. The landing page, 404 and changelog are in the screenshot set.
