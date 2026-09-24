# product-site-template

An Astro + Starlight site for a product: a landing page, optional docs,
optional changelog. It is netscli.com's site, kept in sync with it, with
the product-specific parts collected where a new product replaces them.

The content that ships here describes a fictional product called Example: a
landing page, three docs pages, a FAQ, install routes for three platforms,
and two placeholder images. It is deliberately thin and deliberately
generic. It exists so a fresh clone builds, renders every feature of the
shell and passes its own checks before you have written a word -- and so
that what you delete is obvious. Everything else is the shell.

## What a new product edits

- `src/data/site-content/*.ts` -- all copy, links, install commands, FAQ,
  navigation, the domain, and the `modules` toggles. `src/data/site.ts`
  assembles these into the `site` object every component reads.
- `src/content/docs/**/*.md` -- the docs pages, if `modules.docs` is on.
  Their sidebar, title, description and logo are `site-content/docs.ts`;
  nothing warns when an entry points at a page that no longer exists.
- `src/data/site-content/feedback.ts` -- the two feedback buttons above the
  footer. They open a prefilled GitHub issue on `social.repo`; point them
  somewhere else with `repo`, name your issue forms in `template`, or set
  `enabled: false` to remove the block and its footer link entirely.
- `public/assets/*` -- wordmark, hero screenshot, favicon, OG image.
- `CHANGELOG.md` -- the changelog page's local fallback; it also reads
  GitHub Releases at runtime.
- `src/styles/tokens.css` -- the brand palette, both themes. Then
  `src/styles/docs/theme.css` for how Starlight's tokens map onto it. The
  guide is `src/styles/README.md`.

The sample content is not a starting draft to edit around: replace each
file's contents outright. The comments in them say what each field is for
and where it is rendered, which is the part worth keeping.

## What the shell is

```
src/styles/tokens.css        shared palette and base ramp
src/styles/code-surface.css  the dark surface code sits on, both themes
src/styles/theme-control.css the light/dark/system control
src/styles/docs/             the docs shell, one file per region
src/styles/landing/          the landing page's character and base rules
src/components/*.astro       Nav, Hero, Surfaces, Install, Faq, Footer
src/components/starlight/    the Starlight overrides
src/layouts/Page.astro       meta, OG, JSON-LD, the stylesheet order
src/pages/                   index, 404, changelog, robots.txt
src/scripts/                 landing behaviour, docs behaviour, changelog
scripts/                     the checks CI runs, and two verification tools
```

Starlight's own CSS is inside `@layer`, so the docs files outrank it as
plain rules; the whole shell has five `!important` declarations, all in
`docs/code.css` for inline styles, and `scripts/css-regions.mjs` keeps it
that way.

## Module toggles

`src/data/site-content/modules.ts`:

```ts
export const modules: Modules = { docs: true, changelog: true };
```

`docs: false` removes the Starlight integration from the build and every
docs link from the nav, footer, 404 page and surfaces copy. Delete
`src/content/docs/`, `content.config.ts`, `src/styles/docs/` and
`src/components/starlight/` as well when a product will never have docs.
`changelog: false` removes the changelog links; delete
`src/pages/changelog.astro`, `src/scripts/changelog-page.ts` and
`src/scripts/changelog/` with it; `astro check` fails on the page script otherwise.

## Local development

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # static output into dist/
npm run check        # astro typecheck
```

Node 22 or later; `.nvmrc` pins the version CI uses.

## Checks

CI (`.github/workflows/ci.yml`) runs, all blocking:

| Check | What it catches |
| --- | --- |
| `node scripts/check-file-size.mjs` | a source file over 300 lines |
| `npm run check:css` | a CSS declaration a later file always overrides |
| `npm run check:regions` | an unregistered docs stylesheet, or `!important` |
| `npm run check:wordmark` | the wordmark's transparent margin drifting from its token |
| `npm run build` and `npm run check` | the build, and TypeScript |
| `npm run check:changelog` | a dated changelog heading with no matching tag |
| `npm run test:a11y` | axe-core violations in both themes |
| `npm run check:contrast` | rendered text below its contrast floor |

Two more are for changing the styles, run by hand because they need a
git ref or a browser session:

- `node scripts/css-equivalence.mjs --old origin/main --stack docs|landing`
  works out, for every element, property, width and state, which
  declaration wins before and after your change, and lists the
  differences. `capture-search` first, once, so the search dialog's DOM
  exists.
- `node scripts/visual-snapshot.mjs record` then `check` compares 240
  screenshots (every page plus the open search dialog, two themes, eight
  widths) against a baseline.

`src/styles/docs/README.md` has the workflow.

Two more build assets rather than check them, so they run when the thing
they read changes rather than on every commit:

- `npm run assets:terminal` draws the hero terminal panel from
  `src/data/site-content/terminal.ts` to `public/assets/hero.png`. It takes
  its colours from the stylesheets, so changing an `--ui-ondark-*` token and
  re-running repaints the image to match. Commit the PNG.
- `npm run assets:wordmark` composes `public/mark.svg` with `siteName` into
  `public/assets/wordmark.png` and `wordmark-light.png`. Replace `mark.svg`
  with your own logo and re-run; the mark is a file rather than code because
  the only way to parameterise a drawing is to invent a drawing language, and
  SVG already is one. It prints the transparent-column count, so run
  `npm run check:wordmark` after and set `--ui-mark-inset-ratio` to what it
  reports. Commit both PNGs.
- `npm run assets:install-scripts` copies `install.ps1` and `install.sh` into
  `public/`, from beside the site or the directory above it, so the
  documented one-liner can point at your own domain instead of
  raw.githubusercontent.com. It copies whichever exist and says so when
  neither does.

## Continuous integration

`.github/workflows/ci.yml` runs every check in this repo on
**`ubuntu-latest`**. Nothing to set up: open a pull request and it runs.

This was a self-hosted Windows runner until 2026-09-12. The reasoning was
cost -- this repo is private, so GitHub-hosted minutes are billed against the
account and self-hosted minutes are not -- and it failed in the way that kind
of saving usually does. The runner went offline, and a pull request's checks
sat queued indefinitely: not passing, not failing, just never arriving. The
pull request looked like it was waiting on CI, and CI was waiting on a
machine that was not coming back.

A check that cannot run is worse than a metered one, because nothing about it
looks broken. So the minutes are billed now, and that is the trade: a small
recurring cost for checks that actually report.

The change also removed a security condition the old setup carried. A
self-hosted runner executes whatever a workflow tells it to, on a real
machine -- fine while the repo is private and one person opens the pull
requests, not fine the moment it is public, because a fork's pull request
would then run its own code there. The workflow had a guard step that failed
the job if it ever ran self-hosted on a public repo. Hosted runners make both
the condition and the guard unnecessary, so the guard is gone.

### What to expect

The whole gate is a single job. Two would checkout and `npm ci` twice for no
gain; the step names report separately either way. Expect a few minutes, most
of it the two browser sweeps.

`setup-node`'s `cache: npm` is on. It carries the npm cache between throwaway
hosted VMs, which is exactly this case. It was off under the self-hosted
runner, where `~/.npm` already sat on the disk between runs and caching turned
a local read into an upload and a download -- measured on that workflow's
first run, the checks finished in under four minutes while the cache upload
was still going ten minutes later.

## Preview builds

Set `SITE_PREVIEW=1` on a build that is deployed somewhere other than the
real domain: every page gets `robots: noindex` and the analytics beacon is
left out, so a PR preview neither gets indexed nor reports into the real
property.

## What is still netscli-shaped

Nothing. The tree carries no netscli string outside this file, the CI
workflow header and `.gitattributes`, all of which describe where the shell
comes from rather than what the site says. The last of it went in three
passes: the product name compiled into the 404 page, the changelog page and
two nav labels; four comments that used netscli commands as the measured
example behind a fix; and an unreferenced logo asset.

Two things are worth knowing rather than fixing:

- The landing components carry 37 literal colours, most of them rgba()
  greys; `src/styles/README.md` lists where.
- Deployment is the product's own: there is no `CNAME`, no Pages workflow.

## CI runs on a self-hosted runner

This repository is private, and hosted Actions minutes are metered for
private repositories. Measured 2026-09-21: on `ubuntu-latest` the job
completed in three seconds with zero steps, no log and no annotation --
GitHub declining to schedule it. The same workflow shape runs fine on
`ubuntu-latest` in netscli and nvx, which are public.

So `runs-on` is `[self-hosted, windows]`, and the runner has to be
running for CI to report anything. It is registered as `felix-desktop`;
start it with `run.cmd` in the runner directory, or install it as a
service (`config.cmd --runasservice`, which needs an Administrator
shell) so it survives a reboot. A stopped runner does not fail the
queue, it leaves jobs queued indefinitely -- which is what happened
between 2026-09-12 and 2026-09-21.

The workflow's first step refuses to run if the repository is ever made
public, because a fork's pull request would then execute its own code on
that machine.

## Keeping it in sync

This tree is netscli's `site/` directory, and since 2026-09-03 the two
histories share a base, so a sync is an ordinary merge rather than a
hand-applied patch. In the netscli repo:

```
git subtree split --prefix=site -b site-split main
```

Then here, with netscli added as a remote:

```
git fetch netscli site-split:refs/remotes/netscli/site-split
git merge netscli/site-split
```

Content does not conflict. `.gitattributes` marks the files that are purely
this repo's sample content `merge=ours`, so a sync keeps them whatever
netscli did to its own. That needs the driver defined once per clone:

```
git config merge.ours.driver true
```

Without it nothing breaks; those files just come back as ordinary conflicts
to resolve by hand.

Conflicts appear where a generalisation in this repo touches a line the
sync changed -- the last sync had three, all in `astro.config.mjs`,
`src/data/site.ts` and `src/data/site-content/types.ts`. Resolve by keeping
both sides: this repo's `modules` gating plus netscli's change.

## Starting a new product from this template

Add it as a subtree, so the project shares this history from its first
commit and syncing works in both directions afterwards:

```
git subtree add --prefix=site https://github.com/<owner>/product-site-template main
```

Then four things need doing, because the template is a repo whose root IS
the site and a subtree is a directory inside someone else's repo. All four
were found by doing this rather than by reading it:

1. **Move the CI workflow to the project root.** It arrives at
   `site/.github/workflows/ci.yml`, and GitHub only reads `.github/` at the
   repo root -- so a project that leaves it there has CI that silently does
   not exist. Move it to `.github/workflows/`, add
   `defaults: run: working-directory: site`, and point the file-size guard
   step at `site/scripts/check-file-size.mjs`.
2. **Decide which CHANGELOG the site reads.** `src/pages/changelog.astro`
   imports `../../CHANGELOG.md`, which is the site directory's own copy.
   A product's changelog usually lives at the project root: change the
   import to `../../../CHANGELOG.md` and delete `site/CHANGELOG.md`, or
   keep the site's copy deliberately. `scripts/changelog-dates.mjs` takes
   whichever of the two exists, so it needs no decision of its own — but it
   checks the site's copy first, so a stale `site/CHANGELOG.md` left behind
   is what it will read.
3. **Move `AGENTS.md` up, or leave a pointer.** It arrives at
   `site/AGENTS.md`. An agent working in `site/` will find it; one working
   from the project root may not.
4. **Move `.claude/skills/` up, or the skills are not found.** Same silent
   failure as the CI workflow: Claude Code reads `.claude/` at the repo
   root, and the subtree puts it at `site/.claude/`. Measured on a scratch
   project alongside the other three.

Everything else works unchanged from inside a subtree: the build, all four
static guards, `check:content`, the changelog check (tags resolve from
anywhere in the repo) and the two browser sweeps. Verified on a scratch
project: 6 routes built, every check passed.

### Sending a change back

A fix a product makes in its `site/` directory, back to this template:

```
git subtree push --prefix=site https://github.com/<owner>/product-site-template <branch>
```

That lands a branch here whose history sits directly on top of `main`, with
only the site's commits in it -- open a pull request from it as usual.
Verified the same way: a one-file change in a scratch project arrived here
as one commit against `main`.

`subtree push` re-splits the whole history each time and gets slower as the
project grows; on a large repo prefer a cherry-pick of the same commits
onto a branch cut from `main` here.

Improvements are still easiest to land if they go into netscli first, since
that is the direction the merge above runs.
