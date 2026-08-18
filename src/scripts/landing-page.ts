import { initCopyButtons } from "./landing/copy-buttons";
import { initScreenshotLightbox } from "./landing/lightbox";

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

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    platform?: string;
    /** Async, and Chromium-only. `architecture` is a high-entropy hint,
     *  so it is not exposed on the object directly. */
    getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
  };
}

type OperatingSystem = "windows" | "macos" | "linux";

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
      const refreshMetricSeparators = () => {
        const stars = document.getElementById("stars");
        const downloads = document.getElementById("downloads");
        const metricsSep = document.getElementById("metrics-sep");
        const versionSep = document.getElementById("version-sep");
        const hasStars = Boolean(stars && !stars.hidden);
        const hasDownloads = Boolean(downloads && !downloads.hidden);
        if (metricsSep) metricsSep.hidden = !(hasStars && hasDownloads);
        if (versionSep) versionSep.hidden = !(hasStars || hasDownloads);
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
      fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`)
        .then((r) => (r.ok ? r.json() : null))
        .then((rs: unknown) => {
          if (!Array.isArray(rs)) return;
          const releases = rs as GitHubRelease[];
          const total = releases.reduce(
            (sum, release) => sum + (release.assets ?? []).reduce(
              (assetSum, asset) => assetSum + (asset.download_count ?? 0),
              0,
            ),
            0,
          );
          const el = document.getElementById("downloads");
          if (el) {
            el.textContent = `${fmtDownloads(total)} ${total === 1 ? "download" : "downloads"}`;
            el.dataset.totalDownloads = `Downloads: ${fmt(total)} total`;
            el.setAttribute("aria-label", el.dataset.totalDownloads);
            el.hidden = false;
          }
          refreshMetricSeparators();
          const latest = releases.find((release) => !release.draft && !release.prerelease)
            ?? releases.find((release) => !release.draft);
          const versionEl = document.getElementById("latest-version");
          if (latest && versionEl) {
            if (latest.tag_name) versionEl.textContent = latest.tag_name;
            if (latest.html_url) versionEl.setAttribute("href", latest.html_url);
          }
        })
        .catch(() => {});
    })();

    initCopyButtons();
    initScreenshotLightbox();

    // OS tab swap. Keep visual state and ARIA state aligned so package
    // manager choices work for mouse, keyboard, and assistive tech users.
    const osTabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".os-tab"));
    const osPanels = Array.from(document.querySelectorAll<HTMLElement>(".os-panel"));
    function setOS(os: OperatingSystem, options: { focus?: boolean } = {}) {
      osTabs.forEach((b) => {
        const active = b.dataset.os === os;
        b.classList.toggle("active", active);
        b.setAttribute("aria-selected", String(active));
        b.tabIndex = active ? 0 : -1;
        if (active && options.focus) b.focus();
      });
      osPanels.forEach((p) => {
        const active = p.dataset.os === os;
        p.classList.toggle("active", active);
        p.hidden = !active;
      });
    }
    osTabs.forEach((b, index) => {
      b.addEventListener("click", () => {
        const os = b.dataset.os as OperatingSystem | undefined;
        if (os) setOS(os);
      });
      b.addEventListener("keydown", (event) => {
        const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const last = osTabs.length - 1;
        const nextIndex =
          event.key === "Home" ? 0
            : event.key === "End" ? last
            : event.key === "ArrowLeft" ? (index + last) % osTabs.length
            : (index + 1) % osTabs.length;
        const os = osTabs[nextIndex]?.dataset.os as OperatingSystem | undefined;
        if (os) setOS(os, { focus: true });
      });
    });

    // Auto-detect visitor OS on load. UA-CH is preferred, with the legacy
    // user-agent string retained as a broad-browser fallback.
    {
      const navigatorWithUaData = navigator as NavigatorWithUserAgentData;
      const ua =
        navigatorWithUaData.userAgentData?.platform ||
        navigator.userAgent ||
        "";
      // Mobile and Chrome OS have to be matched explicitly.
      //
      // UA-CH reports `platform` as one of a small fixed set: "Windows",
      // "macOS", "Linux", "Android", "Chrome OS", "iOS". The previous three
      // tests covered only the first three, so Android, iOS and Chrome OS
      // all fell through to the `"macos"` default -- every phone visitor was
      // shown the macOS install tab and offered a .dmg from the hero button.
      // Confirmed on a Pixel 8 UA, where `platform` is exactly "Android".
      //
      // Apple's mobile platforms group with macOS, and Android/Chrome OS
      // with Linux. Neither can actually run NetsCLI, so the goal is only to
      // show the least wrong thing to someone browsing on a phone and to
      // stop claiming a Mac is involved when it is not.
      //
      // `cros` is matched before `linux` deliberately: Chrome OS is
      // Linux-based and some UA strings contain both.
      const detected: OperatingSystem = /win/i.test(ua) ? "windows"
        : /mac|ios|iphone|ipad/i.test(ua) ? "macos"
        : /android|cros|chrome\s?os|linux/i.test(ua) ? "linux"
        : "windows";
      setOS(detected);

      // Both hero command boxes are OS-aware, and they must differ.
      //
      // Only the second box used to be. The first held `hero.quickInstall`
      // -- the `curl … install.sh | bash` line -- for everyone, which made
      // two separate problems:
      //
      //   Windows: the most prominent command on the page was a bash
      //   pipeline that does not run there, with the correct `winget` line
      //   demoted to the smaller box below it.
      //
      //   Linux: `packageCommands.linux` was byte-identical to
      //   `hero.quickInstall`, so the hero printed the same command twice.
      //
      // Primary is whatever the install section recommends for that
      // platform, so the hero and "Get started" agree; secondary is a
      // genuinely different route.
      const heroCommands: Record<OperatingSystem, { primary: string; secondary: string }> = {
        windows: {
          primary: "winget install fstubner.netscli",
          secondary:
            "iwr -useb https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.ps1 | iex",
        },
        macos: {
          primary: "brew tap fstubner/tap && brew install netscli",
          secondary:
            "curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash",
        },
        linux: {
          primary:
            "curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash",
          secondary: "yay -S netscli-bin",
        },
      };

      const setHeroCommand = (id: string, command: string) => {
        const host = document.getElementById(id);
        if (!host) return;
        host.dataset.copy = command;
        const code = host.querySelector("code");
        if (code) code.textContent = command;
      };
      setHeroCommand("hero-quick-install", heroCommands[detected].primary);
      setHeroCommand("hero-package-install", heroCommands[detected].secondary);

      const desktopDownload = document.querySelector<HTMLAnchorElement>("#hero-desktop-download");
      if (desktopDownload) {
        const base = "https://github.com/fstubner/netscli/releases/latest/download";
        // macOS ships two .dmgs and they are NOT interchangeable. This
        // button used to hand every Mac visitor the Apple Silicon build,
        // so Intel users downloaded something that would not run.
        //
        // Default to the Intel build, because Rosetta 2 runs it on Apple
        // Silicon too — an asymmetry worth exploiting, since the wrong
        // guess in that direction still works and the reverse does not.
        // Then upgrade to the native arm64 build if the browser will
        // actually tell us the architecture.
        const desktopUrls: Record<OperatingSystem, string> = {
          windows: `${base}/netscli-gui-windows-x86_64.msi`,
          macos: `${base}/netscli-gui-macos-x86_64.dmg`,
          linux: `${base}/netscli-gui-linux-x86_64.AppImage`,
        };
        desktopDownload.href = desktopUrls[detected];

        if (detected === "macos") {
          // High-entropy hints are async and Chromium-only; Safari never
          // resolves this, which is exactly why the default above has to
          // be the one that runs everywhere.
          navigatorWithUaData.userAgentData
            ?.getHighEntropyValues?.(["architecture"])
            .then(({ architecture }) => {
              if (architecture === "arm") {
                desktopDownload.href = `${base}/netscli-gui-macos-aarch64.dmg`;
              }
            })
            .catch(() => {
              /* keep the Intel default */
            });
        }
      }
    }

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
        document.addEventListener("click", (event) => {
          if (
            !menu.hidden
            && event.target instanceof Node
            && !menu.contains(event.target)
            && event.target !== button
          ) closeMenu();
        });
        menu.querySelectorAll("a").forEach((link) => {
          link.addEventListener("click", closeMenu);
        });
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape") closeMenu();
        });
      }
    }
}
