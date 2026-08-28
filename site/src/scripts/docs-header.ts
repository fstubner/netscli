import { disposeDocsHeader, onDispose, registerDisposal } from './docs-header-disposal';
import { applyDocsTableBehaviour } from './docs-tables';

export function initDocsHeader(): void {
  // Re-entrant under view transitions: drop the previous run's observers
  // before attaching a new set.
  disposeDocsHeader();
  registerDisposal();

  const root = document.documentElement;
  const updateHeaderDepth = () => {
    if (window.scrollY > 6) {
      root.dataset.docsScrolled = 'true';
    } else {
      delete root.dataset.docsScrolled;
    }
  };

  updateHeaderDepth();
  window.addEventListener('scroll', updateHeaderDepth, { passive: true });
  window.addEventListener('resize', updateHeaderDepth);

  let lastMobileScrollY = window.scrollY;
  const updateMobileScrollDirection = () => {
    const scrollY = window.scrollY;
    const delta = scrollY - lastMobileScrollY;

    if (scrollY < 8) {
      root.dataset.mobileScrollDirection = 'up';
      lastMobileScrollY = scrollY;
      return;
    }

    if (Math.abs(delta) < 4) return;

    root.dataset.mobileScrollDirection = delta > 0 ? 'down' : 'up';
    lastMobileScrollY = scrollY;
  };

  updateMobileScrollDirection();
  window.addEventListener('scroll', updateMobileScrollDirection, { passive: true });
  window.addEventListener('resize', updateMobileScrollDirection);

  const placeMobileTableOfContents = () => {
    const wrapper = document.querySelector('.netscli-mobile-toc-wrapper');
    const titlePanel = document.querySelector(
      '.main-pane .content-panel:first-of-type, .content-panel:first-of-type'
    );
    if (!wrapper || !titlePanel || wrapper.previousElementSibling === titlePanel) return;
    titlePanel.after(wrapper);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', placeMobileTableOfContents, { once: true });
  } else {
    placeMobileTableOfContents();
  }
  window.addEventListener('astro:page-load', placeMobileTableOfContents);
  window.addEventListener('resize', placeMobileTableOfContents);

  const buildSearchData = (value: string) => {
    const strong = document.createElement('strong');
    strong.className = 'search-data';
    strong.textContent = value;
    return strong;
  };

  const buildSearchText = (value: string) => {
    const span = document.createElement('span');
    span.className = 'search-message-text';
    span.textContent = value.trim().replace(/\s+/g, ' ');
    return span;
  };

  type SearchMessagePart = string | { value: string };

  const setSearchMessage = (message: Element, parts: SearchMessagePart[]) => {
    message.replaceChildren(
      ...parts.map((part) => {
        if (typeof part === 'string') return buildSearchText(part);
        return buildSearchData(part.value);
      })
    );
    message.setAttribute(
      'aria-label',
      parts
        .map((part) => (typeof part === 'string' ? part : part.value))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
  };

  const enhanceSearchMessages = () => {
    document.querySelectorAll('#starlight__search .pagefind-ui__message').forEach((message) => {
      const text = message.textContent?.trim().replace(/\s+/g, ' ');
      if (
        !text ||
        ((message as HTMLElement).dataset.netscliMessageText === text &&
          message.querySelector('.search-data'))
      ) {
        return;
      }

      const results = text.match(/^([\d,.]+)\s+(results?)\s+for\s+(.+)$/i);
      if (results) {
        setSearchMessage(message, [
          { value: results[1] },
          `${results[2].toLowerCase()} for`,
          { value: results[3] },
        ]);
        (message as HTMLElement).dataset.netscliMessageText = text;
        return;
      }

      const zeroResults = text.match(/^No results for\s+(.+)$/i);
      if (zeroResults) {
        setSearchMessage(message, ['No results for', { value: zeroResults[1] }]);
        (message as HTMLElement).dataset.netscliMessageText = text;
      }
    });
  };

  let searchMessageFrame = 0;
  const scheduleSearchMessageEnhancement = () => {
    if (searchMessageFrame) return;
    searchMessageFrame = window.requestAnimationFrame(() => {
      searchMessageFrame = 0;
      enhanceSearchMessages();
    });
  };

  const searchObserver = new MutationObserver(scheduleSearchMessageEnhancement);
  searchObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  onDispose(() => searchObserver.disconnect());
  scheduleSearchMessageEnhancement();

  let activeSearchOverflowDrawer: Element | null = null;
  const bindSearchOverflowDrawer = () => {
    const drawer = document.querySelector('#starlight__search .pagefind-ui__drawer');
    if (drawer && drawer !== activeSearchOverflowDrawer) {
      activeSearchOverflowDrawer?.removeEventListener('scroll', scheduleSearchOverflowSettled);
      activeSearchOverflowDrawer = drawer;
      drawer.addEventListener('scroll', scheduleSearchOverflowSettled, { passive: true });
    }
    return drawer;
  };

  const updateSearchOverflow = () => {
    const drawer = bindSearchOverflowDrawer();
    if (!drawer) return;

    const maxScroll = drawer.scrollHeight - drawer.clientHeight;
    drawer.classList.toggle('netscli-search-overflow-top', drawer.scrollTop > 2);
    drawer.classList.toggle('netscli-search-overflow-bottom', maxScroll - drawer.scrollTop > 2);
  };

  let searchOverflowFrame = 0;
  const scheduleSearchOverflow = () => {
    if (searchOverflowFrame) return;
    searchOverflowFrame = window.requestAnimationFrame(() => {
      searchOverflowFrame = 0;
      updateSearchOverflow();
    });
  };

  const scheduleSearchOverflowSettled = () => {
    scheduleSearchOverflow();
    window.setTimeout(scheduleSearchOverflow, 120);
    window.setTimeout(scheduleSearchOverflow, 420);
  };

  document.addEventListener(
    'input',
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.matches('#starlight__search .pagefind-ui__search-input')
      ) {
        scheduleSearchOverflowSettled();
      }
    },
    true
  );

  document.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('site-search, #starlight__search')) {
        scheduleSearchOverflowSettled();
      }
    },
    true
  );

  const searchOverflowObserver = new MutationObserver(scheduleSearchOverflow);
  searchOverflowObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  onDispose(() => searchOverflowObserver.disconnect());
  window.addEventListener('resize', scheduleSearchOverflowSettled);
  scheduleSearchOverflowSettled();

  const updateMobileTocCurrent = () => {
    const toc = document.querySelector('mobile-starlight-toc');
    if (!toc) return;

    const links = [...toc.querySelectorAll('a[href^="#"]')];
    if (links.length === 0) return;

    const stickyOffset =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sl-nav-height')) || 60;
    let current = links[0];

    for (const link of links) {
      const href = link.getAttribute('href');
      const id = href === '#_top' ? null : href?.slice(1);
      const target = id ? document.getElementById(decodeURIComponent(id)) : document.body;
      if (!target) continue;

      const top = target.getBoundingClientRect().top;
      if (top <= stickyOffset + 110) {
        current = link;
      } else {
        break;
      }
    }

    links.forEach((link) => {
      if (link === current) {
        if (link.getAttribute('aria-current') !== 'true') {
          link.setAttribute('aria-current', 'true');
        }
      } else if (link.hasAttribute('aria-current')) {
        link.removeAttribute('aria-current');
      }
    });
  };

  let mobileTocFrame = 0;
  const scheduleMobileTocCurrent = () => {
    if (mobileTocFrame) return;
    mobileTocFrame = window.requestAnimationFrame(() => {
      mobileTocFrame = 0;
      updateMobileTocCurrent();
    });
  };

  window.addEventListener('scroll', scheduleMobileTocCurrent, { passive: true });
  window.addEventListener('resize', scheduleMobileTocCurrent);
  window.addEventListener('hashchange', scheduleMobileTocCurrent);
  const mobileTocObserver = new MutationObserver(scheduleMobileTocCurrent);
  mobileTocObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  onDispose(() => mobileTocObserver.disconnect());
  scheduleMobileTocCurrent();
  window.setTimeout(scheduleMobileTocCurrent, 250);
  window.setTimeout(scheduleMobileTocCurrent, 1000);

  applyDocsTableBehaviour();
}
