import { initCopyButtons } from "./landing/copy-buttons";
import { initScreenshotLightbox } from "./landing/lightbox";
import { initOsTabs } from "./landing/os-tabs";

interface GitHubAsset {
  download_count?: number;
}

interface GitHubRelease {
  assets?: GitHubAsset[];
  draft?: boolean;
  prerelease?: boolean;
  tag_name?: string;
  html_url?: string;
}

export function initLandingPage(repo: string): void {
    const year = document.getElementById("y");
    if (year) year.textContent = String(new Date().getFullYear());

    // Live social proof: GitHub stars + cumulative release asset downloads.
    // Unauthenticated GitHub API is rate-limited to 60/hour per IP; on failure
    // hide optional metrics so visitors don't see stale placeholders.
    (function () {
      const fmt = (n: number) => n.toLocaleString();
      const fmtDownloads = (n: number) => {
        if (n < 1000) return fmt(n);
        // One decimal, floored. Whole thousands hid most of the movement --
        // everything from 1,000 to 1,999 read as "1K+". Floored rather than
        // rounded because the "+" claims "at least this many", so 1,999 must
        // not round up to 2.0K+.
        if (n < 1000000) return `${(Math.floor(n / 100) / 10).toFixed(1)}K+`;
        return `${(Math.floor(n / 100000) / 10).toFixed(1)}M+`;
      };
      // Every separator is derived from what is actually on screen, so a
      // partial failure cannot leave a dangling interpunct. The version is
      // part of this now: it is only rendered once a release has confirmed
      // it, so it can be absent like the rest.
      const refreshMetricSeparators = () => {
        const shown = (id: string) => {
          const el = document.getElementById(id);
          return Boolean(el && !el.hidden);
        };
        const setSep = (id: string, visible: boolean) => {
          const el = document.getElementById(id);
          if (el) el.hidden = !visible;
        };
        const hasStars = shown("stars");
        const hasDownloads = shown("downloads");
        const hasVersion = shown("latest-version");
        setSep("metrics-sep", hasStars && hasDownloads);
        setSep("version-sep", (hasStars || hasDownloads) && hasVersion);
        setSep("source-sep", hasStars || hasDownloads || hasVersion);
      };
      fetch(`https://api.github.com/repos/${repo}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d || typeof d.stargazers_count !== "number") return;
          const stars = document.getElementById("stars");
          const count = document.getElementById("stars-count");
          if (count) count.textContent = fmt(d.stargazers_count);
          if (stars) stars.hidden = false;
          refreshMetricSeparators();
        })
        .catch(() => {});
      /* Downloads come from two places, and the count said "total" while
         reporting one of them.
       *
         GitHub release assets are the installers and the standalone
         binaries. crates.io is `cargo install netscli`, which the install
         section offers and which never touched a release asset. Only the
         `netscli` crate is counted: netscli-core and netscli-mcp are
         libraries, so their downloads are dependency resolution and docs.rs
         builds rather than anyone installing anything, and adding them would
         count a single `cargo install` three times.

         Either source may fail or be rate-limited, so each records its own
         number and the label re-renders from whichever have arrived. A
         partial count is better than none, and better than a spinner that
         never resolves. */
      let githubDownloads: number | null = null;
      let cratesDownloads: number | null = null;
      const renderDownloads = () => {
        if (githubDownloads === null && cratesDownloads === null) return;
        const total = (githubDownloads ?? 0) + (cratesDownloads ?? 0);
        const el = document.getElementById("downloads");
        if (el) {
          el.textContent = `${fmtDownloads(total)} ${total === 1 ? "download" : "downloads"}`;
          el.dataset.totalDownloads = `Downloads: ${fmt(total)} total`;
          el.setAttribute("aria-label", el.dataset.totalDownloads);
          el.hidden = false;
        }
        refreshMetricSeparators();
      };

      // crates.io sets `access-control-allow-origin: *`, so this needs no
      // proxy or build step. `downloads` is all-time; `recent_downloads` is
      // the trailing 90 days and is not what the label claims.
      fetch("https://crates.io/api/v1/crates/netscli")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const n = d?.crate?.downloads;
          if (typeof n !== "number") return;
          cratesDownloads = n;
          renderDownloads();
        })
        .catch(() => {});

      fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`)
        .then((r) => (r.ok ? r.json() : null))
        .then((rs: unknown) => {
          if (!Array.isArray(rs)) return;
          const releases = rs as GitHubRelease[];
          githubDownloads = releases.reduce(
            (sum, release) => sum + (release.assets ?? []).reduce(
              (assetSum, asset) => assetSum + (asset.download_count ?? 0),
              0,
            ),
            0,
          );
          renderDownloads();
          const latest = releases.find((release) => !release.draft && !release.prerelease)
            ?? releases.find((release) => !release.draft);
          const versionEl = document.getElementById("latest-version");
          // Only reveal a version a release actually carries.
          if (latest?.tag_name && versionEl) {
            versionEl.textContent = latest.tag_name;
            if (latest.html_url) versionEl.setAttribute("href", latest.html_url);
            versionEl.hidden = false;
            refreshMetricSeparators();
          }
        })
        .catch(() => {});
    })();

    initCopyButtons();
    initScreenshotLightbox();
    initOsTabs();


    // Desktop installer dropdown in the hero.
    {
      const button = document.querySelector<HTMLButtonElement>("#hero-desktop-menu-button");
      const menu = document.querySelector<HTMLElement>("#hero-desktop-menu");
      if (button && menu) {
        const closeMenu = () => {
          menu.hidden = true;
          button.setAttribute("aria-expanded", "false");
        };
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const willOpen = menu.hidden;
          menu.hidden = !willOpen;
          button.setAttribute("aria-expanded", String(willOpen));
        });
        // Capture phase, deliberately.
        //
        // In the bubble phase this never fired for a click on a copy button,
        // because copy-buttons.ts calls `stopPropagation()` on its own click
        // — so opening the installer menu and then copying the command beside
        // it left the menu hanging open over the page. "Click anywhere else
        // and I close" should not be defeatable by whatever you clicked on;
        // capture runs before any of it.
        document.addEventListener(
          "click",
          (event) => {
            if (
              !menu.hidden
              && event.target instanceof Node
              && !menu.contains(event.target)
              && event.target !== button
            ) closeMenu();
          },
          true,
        );
        menu.querySelectorAll("a").forEach((link) => {
          link.addEventListener("click", closeMenu);
        });
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape") closeMenu();
        });
      }
    }
}
