/* The theme control, on both top bars.
 *
 * Reads and writes `starlight-theme`, the same localStorage key the docs use,
 * so a choice made on either half of the site holds on the other. The
 * pre-paint script in Page.astro applies whatever this stores.
 *
 * Three values, matching the docs' own control: an explicit `light` or `dark`
 * is stored; `auto` REMOVES the key rather than storing the word, so the page
 * follows the operating system from then on. Storing "auto" would work too,
 * but then the stored value and the applied value are different things and
 * every reader of the key has to know that.
 *
 * The control is a button and a menu rather than a <select>, because a
 * select's list is drawn by the platform and cannot be styled or positioned
 * -- see components/ThemeControl.astro. That makes opening, closing and
 * keyboard handling this file's job, which is the cost of the change.
 */

type Theme = 'light' | 'dark';
type Choice = Theme | 'auto';

const KEY = 'starlight-theme';
const LABELS: Record<Choice, string> = { dark: 'Dark', light: 'Light', auto: 'Auto' };

function systemTheme(): Theme {
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function initThemeSelect(): void {
  // Both bars render one of these; the docs bar has exactly one, and so does
  // the landing page. Wiring every match keeps this correct if a layout ever
  // shows two.
  for (const root of document.querySelectorAll<HTMLElement>('[data-theme-control]')) {
    initControl(root);
  }
}

function initControl(root: HTMLElement): void {
  const trigger = root.querySelector<HTMLButtonElement>('[data-theme-trigger]');
  const menu = root.querySelector<HTMLElement>('[data-theme-menu]');
  const label = root.querySelector<HTMLElement>('[data-theme-label]');
  const options = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-theme-option]'));
  if (!trigger || !menu || !label || options.length === 0) return;

  // Reflect the current state rather than assuming the markup's default. The
  // control renders with "Auto", but the reader may have chosen something on
  // a previous visit or in the other half of the site.
  let choice: Choice = stored() ?? 'auto';

  const reflect = (): void => {
    label.textContent = LABELS[choice];
    for (const option of options) {
      option.setAttribute('aria-checked', option.dataset.themeOption === choice ? 'true' : 'false');
    }
  };

  const close = (focusTrigger = false): void => {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger) trigger.focus();
  };

  const open = (): void => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    // The current choice takes focus, so the keyboard starts where the eye is.
    const current = options.find((option) => option.dataset.themeOption === choice);
    (current ?? options[0]).focus();
  };

  const choose = (next: Choice): void => {
    choice = next;
    try {
      if (next === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked: the choice still applies to this page, it just will
      // not survive a navigation. Better than doing nothing.
    }
    // The icon follows the CHOICE, not the applied theme: on "auto" the page
    // may be dark while the control should still show the laptop. See the
    // icon rules in styles/theme-control.css.
    document.documentElement.dataset.themeChoice = next;
    apply(next === 'auto' ? systemTheme() : next);
    reflect();
    close(true);
  };

  reflect();

  trigger.addEventListener('click', () => {
    if (menu.hidden) open();
    else close();
  });

  for (const option of options) {
    option.addEventListener('click', () => {
      const next = option.dataset.themeOption;
      if (next === 'dark' || next === 'light' || next === 'auto') choose(next);
    });
  }

  // Arrow keys walk the menu, Escape leaves it, Home and End jump. Without
  // this the menu is reachable by Tab but behaves like three loose buttons,
  // which is not what `role="menu"` promises a screen reader.
  menu.addEventListener('keydown', (event) => {
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (index + step + options.length) % options.length;
      options[next].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      options[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      options[options.length - 1].focus();
    }
  });

  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && menu.hidden) {
      event.preventDefault();
      open();
    }
  });

  // A click anywhere else closes it, and so does moving focus out -- the
  // second matters for the keyboard, where there is no click to catch.
  document.addEventListener('click', (event) => {
    if (!root.contains(event.target as Node)) close();
  });
  root.addEventListener('focusout', () => {
    // Deferred: at focusout time the new element is not focused yet, so
    // `contains` would say the focus left when it only moved between items.
    setTimeout(() => {
      if (!root.contains(document.activeElement)) close();
    }, 0);
  });

  // Follow the system while the reader is on "auto", so a theme change in the
  // OS is picked up without a reload.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (stored() === null) apply(systemTheme());
  });
}
