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
}
