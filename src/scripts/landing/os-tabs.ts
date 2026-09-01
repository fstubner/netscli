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
import { INSTALL_PS1_COMMAND, INSTALL_SH_COMMAND } from '../../data/site-content/install-urls';

export function initOsTabs(): void {
  // OS tab swap. Keep visual state and ARIA state aligned so package
  // manager choices work for mouse, keyboard, and assistive tech users.
  const osTabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".os-tab"));
  const osPanels = Array.from(document.querySelectorAll<HTMLElement>(".os-panel"));
  // A chosen tab outlives the page. Detection is a guess -- someone on a
  // Windows machine installing on a Linux box was re-guessed back to
  // Windows on every reload, losing the choice they had just made.
  const OS_KEY = "netscli:install-os";
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
    //   Linux: `packageCommands.linux` was byte-identical to
    //   `hero.quickInstall`, so the hero printed the same command twice.
    //
    // Keyed by ROUTE, not by rank.
    //
    // These were `primary` and `secondary`, meaning "what the install section
    // recommends" and "a genuinely different route" -- but the two rows the
    // hero puts them in are different SIZES, not different ranks, and Linux
    // had the script under `primary` while Windows and macOS had it under
    // `secondary`. So the wide row got a package-manager command on two
    // platforms and a 90-character URL on the third. Naming them for what
    // they are lets each row take the one that fits it.
    const heroCommands: Record<OperatingSystem, { packageManager: string; script: string }> = {
      windows: {
        // Moniker, matching the hero's server-rendered default. `Moniker:
        // netscli` is published in the winget catalog alongside the
        // canonical `fstubner.netscli`, so both resolve.
        packageManager: "winget install netscli",
        script:
          INSTALL_PS1_COMMAND,
      },
      macos: {
        packageManager: "brew tap fstubner/tap && brew install netscli",
        script:
          INSTALL_SH_COMMAND,
      },
      linux: {
        packageManager: "yay -S netscli-bin",
        script:
          INSTALL_SH_COMMAND,
      },
    };

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

      // Keep the caption and the href saying the same thing. They are set
      // together on purpose: a cue that describes a different file from the
      // one the button fetches is worse than no cue.
      const cueText: Record<OperatingSystem, string> = {
        windows: 'Windows · .msi installer',
        macos: 'macOS · Intel .dmg',
        linux: 'Linux · .AppImage',
      };
      const cue = document.getElementById('hero-desktop-cue');
      if (cue) cue.textContent = cueText[detected];

      if (detected === "macos") {
        // High-entropy hints are async and Chromium-only; Safari never
        // resolves this, which is exactly why the default above has to
        // be the one that runs everywhere.
        navigatorWithUaData.userAgentData
          ?.getHighEntropyValues?.(["architecture"])
          .then(({ architecture }) => {
            if (architecture === "arm") {
              desktopDownload.href = `${base}/netscli-gui-macos-aarch64.dmg`;
              // The caption moves with the href. Without this the button
              // would fetch the Apple Silicon build while the line under it
              // still read "Intel .dmg".
              if (cue) cue.textContent = 'macOS · Apple silicon .dmg';
            }
          })
          .catch(() => {
            /* keep the Intel default */
          });
      }
    }
  }
}
