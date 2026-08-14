export function initScreenshotLightbox(): void {
  let lastFocused: HTMLElement | null = null;
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

  const previewCandidate = lightbox.querySelector<HTMLImageElement>("img");
  const captionCandidate = lightbox.querySelector<HTMLElement>(".image-lightbox-caption");
  const closeCandidate = lightbox.querySelector<HTMLButtonElement>(".image-lightbox-close");

  if (!previewCandidate || !captionCandidate || !closeCandidate) {
    lightbox.remove();
    return;
  }

  const preview = previewCandidate;
  const caption = captionCandidate;
  const close = closeCandidate;

  function openLightbox(image: HTMLImageElement) {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    preview.src = image.currentSrc || image.src;
    preview.alt = image.alt || "";
    caption.textContent = image.alt || "";
    lightbox.classList.add("open");
    document.body.classList.add("lightbox-open");
    close.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove("open");
    document.body.classList.remove("lightbox-open");
    lastFocused?.focus();
  }

  document.querySelectorAll<HTMLImageElement>(".bigshot img, .surface-visual img").forEach((image) => {
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `Open larger preview: ${image.alt || "screenshot"}`);
    image.addEventListener("click", () => openLightbox(image));
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openLightbox(image);
      }
    });
  });

  function trapFocus(event: KeyboardEvent) {
    if (!lightbox.classList.contains("open") || event.key !== "Tab") return;
    const focusable = lightbox.querySelectorAll<HTMLElement>(
      'button, [href], [tabindex]:not([tabindex="-1"])',
    );
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
    if (event.key === "Escape" && lightbox.classList.contains("open")) closeLightbox();
    trapFocus(event);
  });
}
