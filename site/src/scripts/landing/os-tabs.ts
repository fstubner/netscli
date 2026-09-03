/**
 * Which operating system the install section is showing, and the hero's
 * desktop download link that follows from it.
 *
 * Split out of landing-page.ts when that file crossed the 300-line guard.
 * It is the one part of the page with its own state: a detected default, an
 * explicit user choice that overrides and outlives it, and a download URL
 * derived from both.
 */
import type { NavigatorWithUserAgentData, OperatingSystem } from './os-types';
import { heroCommands, heroDownloads } from '../../data/site-content/hero';

export function initOsTabs(): void {
  // OS tab swap. Keep visual state and ARIA state aligned so package
  // manager choices work for mouse, keyboard, and assistive tech users.
  const osTabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".os-tab"));
  const osPanels = Array.from(document.querySelectorAll<HTMLElement>(".os-panel"));
  // A chosen tab outlives the page. Detection is a guess -- someone on a
  // Windows machine installing on a Linux box was re-guessed back to
  // Windows on every reload, losing the choice they had just made.
  const OS_KEY = "site:install-os";
  const remember = (os: OperatingSystem) => {
    try {
      localStorage.setItem(OS_KEY, os);
    } catch {
      // Private mode or a blocked origin: detection still applies.
    }
  };
  const remembered = (): OperatingSystem | null => {
    try {
      const value = localStorage.getItem(OS_KEY);
      return value === "windows" || value === "macos" || value === "linux" ? value : null;
    } catch {
      return null;
    }
  };
  function setOS(os: OperatingSystem, options: { focus?: boolean; persist?: boolean } = {}) {
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
    if (options.persist) remember(os);
  }
  osTabs.forEach((b, index) => {
    b.addEventListener("click", () => {
      const os = b.dataset.os as OperatingSystem | undefined;
      if (os) setOS(os, { persist: true });
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
      if (os) setOS(os, { focus: true, persist: true });
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
    setOS(remembered() ?? detected);

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
    //   Linux: the package command was byte-identical to
    //   `hero.quickInstall`, so the hero printed the same command twice.
    //
    // The pairs themselves are content, in site-content/hero.ts.

    const setHeroCommand = (id: string, command: string) => {
      const host = document.getElementById(id);
      if (!host) return;
      host.dataset.copy = command;
      const code = host.querySelector("code");
      if (code) code.textContent = command;
    };
    // `hero-quick-install` is the wide slot beside the Desktop app button and
    // takes the script one-liner; `hero-package-install` is the narrower row
    // below and takes the package-manager command. Named per role rather than
    // per position, so the two stay right if the rows ever move again.
    setHeroCommand("hero-quick-install", heroCommands[detected].script);
    setHeroCommand("hero-package-install", heroCommands[detected].packageManager);

    const desktopDownload = document.querySelector<HTMLAnchorElement>("#hero-desktop-download");
    if (desktopDownload) {
      // Which installer a visitor on this OS is offered. The content file
      // marks one entry per OS `preferred`; the first entry for that OS is
      // the fallback, so a list that forgets the flag still offers something
      // for the right platform rather than nothing.
      const forOs = heroDownloads.filter((d) => d.os === detected);
      const chosen = forOs.find((d) => d.preferred) ?? forOs[0];
      const cue = document.getElementById("hero-desktop-cue");
      // Keep the caption and the href saying the same thing. They are set
      // together on purpose: a cue that describes a different file from the
      // one the button fetches is worse than no cue.
      const offer = (download: (typeof heroDownloads)[number]) => {
        desktopDownload.href = download.href;
        if (cue) cue.textContent = download.cue;
      };
      if (chosen) offer(chosen);

      const armBuild = forOs.find((d) => d.appleSilicon);
      if (armBuild) {
        // High-entropy hints are async and Chromium-only; Safari never
        // resolves this, which is why the entry chosen above has to be one
        // that runs everywhere -- on macOS that is the Intel build, which
        // Rosetta 2 also runs on Apple silicon.
        navigatorWithUaData.userAgentData
          ?.getHighEntropyValues?.(["architecture"])
          .then(({ architecture }) => {
            if (architecture === "arm") offer(armBuild);
          })
          .catch(() => {
            /* keep the entry chosen above */
          });
      }
    }
  }
}
