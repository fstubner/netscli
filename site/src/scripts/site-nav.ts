export function initActiveNav(): void {
  const links = [...document.querySelectorAll('[data-site-nav-link][data-section]')];
  if (!links.length) return;

  const setActive = (sectionId: string) => {
    links.forEach((link) => {
      if (link instanceof HTMLElement && link.dataset.section === sectionId) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  const updateActive = () => {
    const offset = window.scrollY + Math.max(120, window.innerHeight * 0.28);
    let active = links[0]?.dataset.section;
    links.forEach((link) => {
      if (!(link instanceof HTMLElement)) return;
      const section = document.getElementById(link.dataset.section ?? '');
      if (section && section.offsetTop <= offset) {
        active = link.dataset.section;
      }
    });
    if (active) setActive(active);
  };

  updateActive();
  window.addEventListener('scroll', updateActive, { passive: true });
  window.addEventListener('resize', updateActive);
}

export function initMobileNav(): void {
  const nav = document.querySelector('[data-site-nav]');
  const toggle = nav?.querySelector('[data-site-nav-toggle]');
  const links = nav?.querySelector('[data-site-nav-links]');
  if (!nav || !toggle || !links) return;

  const setOpen = (open: boolean) => {
    if (nav instanceof HTMLElement) {
      nav.dataset.open = open ? 'true' : 'false';
    }
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  links.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Node) || !nav.contains(event.target)) {
      setOpen(false);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      if (toggle instanceof HTMLElement) toggle.focus();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) setOpen(false);
  });
}
