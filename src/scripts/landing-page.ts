export function initLandingPage(repo: string): void {
document.getElementById("y").textContent = new Date().getFullYear();

    // Live social proof: GitHub stars + cumulative release asset downloads.
    // Unauthenticated GitHub API is rate-limited to 60/hour per IP; on failure
    // hide optional metrics so visitors don't see stale placeholders.
    (function () {
      const fmt = (n) => n.toLocaleString();
      const fmtDownloads = (n) => {
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
        .then((rs) => {
          if (!Array.isArray(rs)) return;
          const total = rs.reduce(
            (sum, r) => sum + (r.assets || []).reduce((s, a) => s + (a.download_count || 0), 0),
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
          const latest = rs.find((r) => !r.draft && !r.prerelease) || rs.find((r) => !r.draft);
          const versionEl = document.getElementById("latest-version");
          if (latest && versionEl) {
            if (latest.tag_name) versionEl.textContent = latest.tag_name;
            if (latest.html_url) versionEl.setAttribute("href", latest.html_url);
          }
        })
        .catch(() => {});
    })();

    // Copy buttons on every .has-copy block and FAQ command row.
    document.querySelectorAll(".has-copy, .faq-command").forEach((el) => {
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
        let t = el.dataset.copy || el.querySelector("code")?.textContent.trim() || el.textContent.trim();
        if (el.classList.contains("codeblock") || el.classList.contains("tryblock")) {
          t = t
            .split("\n")
            .map((l) => l.replace(/^\$\s*/, "").replace(/\s*\/\/.*$/, "").trim())
            .filter((l) => l)
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

    // Screenshot lightbox. Landing-page images are product evidence, so make
    // them inspectable without navigating away from the page.
    {
      let lastFocused = null;
      const lightbox = document.createElement("div");
      lightbox.className = "image-lightbox";
      lightbox.setAttribute("role", "dialog");
      lightbox.setAttribute("aria-modal", "true");
      lightbox.setAttribute("aria-label", "Image preview");
      lightbox.innerHTML = `
        <div class="image-lightbox-panel">
          <button class="image-lightbox-close" type="button" aria-label="Close image preview">×</button>
          <div class="image-lightbox-frame">
            <img alt="" />
          </div>
          <p class="image-lightbox-caption"></p>
        </div>
      `;
      document.body.appendChild(lightbox);

      const preview = lightbox.querySelector("img");
      const caption = lightbox.querySelector(".image-lightbox-caption");
      const close = lightbox.querySelector(".image-lightbox-close");

      function openLightbox(img) {
        lastFocused = document.activeElement;
        preview.src = img.currentSrc || img.src;
        preview.alt = img.alt || "";
        caption.textContent = img.alt || "";
        lightbox.classList.add("open");
        document.body.classList.add("lightbox-open");
        close.focus();
      }

      function closeLightbox() {
        lightbox.classList.remove("open");
        document.body.classList.remove("lightbox-open");
        if (lastFocused && typeof lastFocused.focus === "function") {
          lastFocused.focus();
        }
      }

      document.querySelectorAll(".bigshot img, .surface-visual img").forEach((img) => {
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", `Open larger preview: ${img.alt || "screenshot"}`);
        img.addEventListener("click", () => openLightbox(img));
        img.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openLightbox(img);
          }
        });
      });

      function trapFocus(event) {
        if (!lightbox.classList.contains("open") || event.key !== "Tab") return;
        const focusable = lightbox.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }

      close.addEventListener("click", closeLightbox);
      lightbox.addEventListener("click", (event) => {
        if (event.target === lightbox) closeLightbox();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && lightbox.classList.contains("open")) {
          closeLightbox();
        }
        trapFocus(event);
      });
    }

    // OS tab swap. Keep visual state and ARIA state aligned so package
    // manager choices work for mouse, keyboard, and assistive tech users.
    const osTabs = Array.from(document.querySelectorAll(".os-tab"));
    const osPanels = Array.from(document.querySelectorAll(".os-panel"));
    function setOS(os, options = {}) {
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
      b.addEventListener("click", () => setOS(b.dataset.os));
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
        setOS(osTabs[nextIndex].dataset.os, { focus: true });
      });
    });

    // Auto-detect visitor OS on load. UA-CH preferred; falls back to the
    // deprecated navigator.platform; final fallback is macOS for unknowns.
    {
      const ua =
        (navigator.userAgentData && navigator.userAgentData.platform) ||
        navigator.platform ||
        "";
      const detected = /win/i.test(ua) ? "windows"
        : /mac/i.test(ua) ? "macos"
        : /linux/i.test(ua) ? "linux"
        : "macos";
      setOS(detected);

      const packageInstall = document.getElementById("hero-package-install");
      if (packageInstall) {
        const packageCommands = {
          windows: "winget install fstubner.netscli",
          macos: "brew tap fstubner/tap && brew install netscli",
          linux: "curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash",
        };
        const packageCommand = packageCommands[detected] || packageCommands.linux;
        packageInstall.dataset.copy = packageCommand;
        const code = packageInstall.querySelector("code");
        if (code) code.textContent = packageCommand;
      }

      const desktopDownload = document.getElementById("hero-desktop-download");
      if (desktopDownload) {
        const desktopUrls = {
          windows: "https://github.com/fstubner/netscli/releases/latest/download/netscli-gui-windows-x86_64.msi",
          macos: "https://github.com/fstubner/netscli/releases/latest/download/netscli-gui-macos-aarch64.dmg",
          linux: "https://github.com/fstubner/netscli/releases/latest/download/netscli-gui-linux-x86_64.AppImage",
        };
        desktopDownload.href = desktopUrls[detected] || desktopUrls.windows;
      }
    }

    // Desktop installer dropdown in the hero.
    {
      const button = document.getElementById("hero-desktop-menu-button");
      const menu = document.getElementById("hero-desktop-menu");
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
          if (!menu.hidden && !menu.contains(event.target) && event.target !== button) closeMenu();
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
