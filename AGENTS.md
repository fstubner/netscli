# Setting up a site from this template

This repo is a working site for a fictional product called Example. Your job
is to turn it into a working site for a real one. Everything you need to
change is content; the shell around it is already built, measured and gated,
and changing it is how sites here break.

Run this first and last:

```
npm run check:content
```

It lists what is still the template's sample, and exits 0 when nothing is.
That is the definition of done for setup — not "it builds", which it already
did before you started.

## Ask before you write

Do not invent the product. If you have not been told, ask for:

- what it is, in one sentence a stranger would understand;
- who it is for, and the one thing they want to do with it;
- the install routes that actually exist, per platform, and whether there is
  a desktop build at all;
- the repo and the domain;
- whether it has documentation yet.

Copy written from a guess reads like copy written from a guess, and it is the
part of the site nobody rewrites later.

## The order to work in

1. **`src/data/site-content/meta.ts`** — the name, domain, title, description
   and share image. Everything else derives the product's name from here, so
   do this one first.
2. **`hero.ts`** — headline, subhead, the two commands, the installer menu.
   Leave `heroDownloads` empty if there is no desktop build: the button and
   its menu then do not render at all, and the install command takes the row.
3. **`install.ts`**, **`surfaces.ts`**, **`faq.ts`**, **`footer.ts`** — the
   sections down the page. Position 0 in each install list is the recommended
   route and renders as the card.
4. **`modules.ts`** — turn `docs`, `changelog` or `privacy` off if the
   product has no use for it. `docs: false` takes Starlight out of the build too, so the site
   drops to three routes with no config edit; delete the docs sources
   afterwards if they will never come back.
5. **`sections.ts`** — which landing sections render, in what order, and
   which of the two layouts. Dropping a section drops the links into it, so
   a product with no install story removes `'install'` rather than filling
   it with something weak. `landingLayout` is `'centered'` (everything on
   the centre line, screenshot below) or `'split'` (copy left, screenshot
   right, tighter sections); below 900px they are the same page.
6. **The docs**, if any: `src/content/docs/docs/*.md`, and `docs.ts` for the
   sidebar. Nothing warns you when a sidebar entry points at a page that does
   not exist — `check:content` does.
7. **The assets**: `public/assets/`. After replacing the wordmark, run
   `npm run check:wordmark`; it measures the asset `meta.ts` names and fails
   if the inset token no longer matches it.
8. **The theme**: `npm run theme -- --accent "#xxxxxx" --verify` rewrites the
   accent family in both themes and in the landing tier -- twenty tokens --
   then builds and measures the result, stepping the colour until every
   rendered node clears 4.5:1. Without `--verify` it writes and stops. Add
   `--dry-run` to see the values first. Deeper changes are
   `src/styles/tokens.css`, with `src/styles/README.md` as the guide.

## What proves it works

Run all of these before you say you are finished. Each one has caught a real
defect in this shell; none of them is decorative.

```
npm run check:content    # nothing is still the sample
npx astro check          # types
npm run build            # 6 routes, or 3 with docs off
npm run check:css        # no CSS declaration that can never apply
npm run check:regions    # docs styles stay one file per region
npm run check:wordmark   # the wordmark inset token matches the asset
npm run check:changelog  # no dated release that has no tag
npm run check:contrast   # every rendered text node clears its floor
npm run test:a11y        # axe, both themes
```

The contrast and a11y sweeps drive a real browser over the built site. They
are slower than the rest and they are the two that catch what review does
not. Both start their own preview server, so stop any you left running
(`npx astro preview stop`) or they time out waiting for a port that is
already taken.

## What not to touch

- **`src/components/`, `src/layouts/`, `src/scripts/`, `src/styles/`** — the
  shell. It is synced from netscli's site (see the README), so a change here
  is a change you will have to make again after every sync. If a component
  hard-codes something that should be content, that is a bug worth fixing —
  fix it upstream rather than locally.
- **`src/data/site-content/types.ts`** — the shape, not the content. Adding a
  field here means adding it to the shell too.
- **The check scripts**, unless the check itself is wrong. A check that is
  edited to pass is worse than no check.

## Two things that will not fail loudly

Both have shipped broken here before, which is why they are named:

- A **sidebar entry with no page** builds a link to nothing, in the sidebar of
  every docs page. Nothing in the build complains.
- A **replaced wordmark with a different transparent margin** renders slightly
  indented in both bars. `check:wordmark` is the only thing that sees it.

## If this site is a subtree inside a product's repo

The template's root is the site root; a subtree puts the site in `site/`.
Four things move with it, and the README's "Starting a new product" section
has the detail: the CI workflow has to sit at the PROJECT root to run at
all, `changelog.astro` reads the site directory's `CHANGELOG.md` rather than
the product's, this file arrives at `site/AGENTS.md`, and `.claude/skills/`
arrives at `site/.claude/skills/` where nothing looks for it.

The skills in `.claude/skills/` are the entry points for the work that
happens here repeatedly: `product-site-customise` for editing a site's
content, `product-site-spin-off` for starting one, `product-site-upstream`
for sending a generic change back here, and `product-site-sync` for moving
changes in either direction.

Everything else is unchanged: run the commands above from inside `site/`.

## Style

The copy on this site is plain: short sentences, no "powerful" or "seamless",
no exclamation marks, and no claim the product cannot back. Section leads say
what the section is for rather than selling it. Match that, or decide
deliberately not to — but decide.
