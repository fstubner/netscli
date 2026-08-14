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
        if (n < 1000000) return `${Math.floor(n / 1000)}K+`;
        return `${Math.floor(n / 1000000)}M+`;
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

    // Copy buttons on every .has-copy block and FAQ command row.
    document.querySelectorAll<HTMLElement>(".has-copy, .faq-command").forEach((el) => {
      if (el.querySelector(":scope > .copy-btn")) return;
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.type = "button";
      btn.setAttribute("aria-label", "Copy command");
      btn.title = "Copy command";
      const copyIcon = `
        <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
          <path d="M5.5 2.5h7v9h-7z"></path>
          <path d="M3.5 4.5h-1v9h7v-1"></path>
        </svg>
      `;
      const copiedIcon = `
        <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
          <path d="M3 8.2 6.1 11 13 4"></path>
        </svg>
      `;
      btn.innerHTML = copyIcon;
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        let t = el.dataset.copy
          || el.querySelector("code")?.textContent?.trim()
          || el.textContent?.trim()
          || "";
        if (el.classList.contains("codeblock") || el.classList.contains("tryblock")) {
          t = t
            .split("\n")
            .map((line: string) => line.replace(/^\$\s*/, "").replace(/\s*\/\/.*$/, "").trim())
            .filter(Boolean)
            .join("\n");
        }
        navigator.clipboard.writeText(t).then(() => {
          btn.innerHTML = copiedIcon;
          btn.classList.add("copied");
          btn.setAttribute("aria-label", "Copied");
          btn.title = "Copied";
          setTimeout(() => {
            btn.innerHTML = copyIcon;
            btn.classList.remove("copied");
            btn.setAttribute("aria-label", "Copy command");
            btn.title = "Copy command";
          }, 2500);
        }).catch(() => {
          btn.setAttribute("aria-label", "Copy failed");
          btn.title = "Copy failed";
        });
      });
      el.appendChild(btn);
    });

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
      const detected: OperatingSystem = /win/i.test(ua) ? "windows"
        : /mac/i.test(ua) ? "macos"
        : /linux/i.test(ua) ? "linux"
        : "macos";
      setOS(detected);

      const packageInstall = document.getElementById("hero-package-install");
      if (packageInstall) {
        const packageCommands: Record<OperatingSystem, string> = {
          windows: "winget install fstubner.netscli",
          macos: "brew tap fstubner/tap && brew install netscli",
          linux: "curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash",
        };
        const packageCommand = packageCommands[detected];
        packageInstall.dataset.copy = packageCommand;
        const code = packageInstall.querySelector("code");
        if (code) code.textContent = packageCommand;
      }

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
