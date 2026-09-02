/* The landing page's theme control.
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
 */

type Theme = 'light' | 'dark';

const KEY = 'starlight-theme';

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
  const select = document.querySelector<HTMLSelectElement>('[data-theme-select]');
  if (!select) return;

  // Reflect the current state rather than assuming the markup's default. The
  // control renders with "Auto" selected, but the reader may have chosen
  // something on a previous visit or in the docs.
  select.value = stored() ?? 'auto';

  select.addEventListener('change', () => {
    const choice = select.value;
    try {
      if (choice === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      // Storage blocked: the choice still applies to this page, it just will
      // not survive a navigation. Better than doing nothing.
    }
    // The icon follows the CHOICE, not the applied theme: on "auto" the page
    // may be dark while the control should still show the laptop. See the
    // icon rules in styles/theme-control.css.
    document.documentElement.dataset.themeChoice = choice;
    apply(choice === 'auto' ? systemTheme() : (choice as Theme));
  });

  // Follow the system while the reader is on "auto", so a theme change in the
  // OS is picked up without a reload.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (stored() === null) apply(systemTheme());
  });
}
