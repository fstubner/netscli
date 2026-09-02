# Docs styles

One file per region of the Starlight docs shell. This directory replaced a
30-file, load-order-dependent override stack; the rules for keeping it that
way are short.

## Files

| File | Owns |
| --- | --- |
| `theme.css` | Every token the docs read, both themes: Starlight's `--sl-*` mapped onto the brand palette, plus docs-only surfaces and layout widths. **Re-theme here.** |
| `base.css` | The document: box model, body font, scrollbars, scroll behaviour. |
| `shell.css` | The frame that holds the rails and the page, and the title band. |
| `header.css`, `header-controls.css` | The sticky bar and where its controls sit; the search and menu buttons' appearance. |
| `sidebar.css` | The section rail, and the floating menu it becomes on a phone. |
| `toc.css`, `toc-bar.css` | The contents rail; the collapsed "On this page" bar below 72rem. |
| `content.css` | Prose: links, headings, inline code, callouts, pagination. |
| `code.css` | Expressive Code blocks, copy button, token colours. |
| `tables.css`, `tables-narrow.css` | Tables; what changes below 72rem. |
| `search.css`, `search-input.css`, `search-results.css` | The search dialog, its input row and states, its results. |

The brand palette itself (`--netscli-accent` and friends) is in
`../tokens.css`, which the landing page loads too. The code surface tokens
are in `../code-surface.css` for the same reason.

## Rules

- **No `!important`.** Starlight's own CSS is inside `@layer starlight.*`,
  and files listed in `customCss` load unlayered, so a plain rule already
  outranks anything Starlight ships. The five token remaps in `code.css`
  are the one exception, because they override inline `style` attributes;
  `scripts/css-regions.mjs` allows exactly those.
- **No load-order dependence between files**, except two pairs that say so
  at the top of the file: `search-input.css` before `search.css`, and
  `tables.css` before `tables-narrow.css`. `scripts/css-shadowing.mjs`
  runs at budget 0 to catch a declaration that another file silently
  overrides.
- **300 lines per file.** When a file outgrows that, split it at a seam a
  reader would recognise (wide/narrow, control/placement), not at line 300.

## Changing something

1. Edit the region's file.
2. `node scripts/visual-snapshot.mjs check` compares 240 screenshots (14
   routes plus the open search dialog, two themes, eight widths) against
   `.visual-baseline/`. Record a baseline from `main` first if you do not
   have one. A change you intended shows up as a diff pair in
   `.visual-diff/`; re-run `record` to accept it.
3. `node scripts/css-equivalence.mjs --old origin/main` compares, for every
   element, property, width and state, which declaration wins under
   `main`'s stylesheets and under yours. It sees hover, focus and the light
   theme where a screenshot cannot; run `capture-search` once first so the
   search dialog's DOM exists. Its header lists what it cannot model.
4. `npm run check:css`, `npm run check:regions`, `npm run check:contrast`
   and `npm run test:a11y` are what CI runs.

Hover, focus and the search dialog's empty and no-results states are not in
the screenshots. Check those by hand in the preview.

## Using this as a template

Copy this directory, `../tokens.css`, `../code-surface.css` and
`../theme-control.css`, and the `customCss` list in `astro.config.mjs`.
Then edit `theme.css` for the palette and `../tokens.css` for the brand
accent. The region files are not fully tokenised: outside `theme.css`,
50 hex literals remain (20 of them in `code.css`, 16 across the three
search files), plus rgba() greys with literal channels. A re-theme that
changes more than the accent and the greys will have to visit those; this
grep lists them:

    grep -nE "#[0-9a-f]{6}" src/styles/docs/*.css | grep -v theme.css
