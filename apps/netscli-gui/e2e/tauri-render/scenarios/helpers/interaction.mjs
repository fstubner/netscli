import assert from 'node:assert/strict';
import { By } from '../../driver.mjs';
import { clickButtonText, waitForNoElement, waitForText } from '../../ui.mjs';
import { getActiveTabText } from './menu.mjs';
import { assertAlignment } from './alignment.mjs';

async function assertCommandStatusAlignment(driver) {
  await waitForText(driver, '[data-testid="statusbar"] .status-left', /Mbps/i, 6_000);
  const state = await driver.executeScript(`
    const terminal = document.querySelector('[data-testid="command-strip"] > svg');
    const copy = document.querySelector('[data-testid="command-strip"] button svg');
    const dot = document.querySelector('[data-testid="statusbar"] .run-dot');
    const status = document.querySelector('[data-testid="statusbar"]');
    if (!terminal || !copy || !dot || !status) return null;
    const terminalRect = terminal.getBoundingClientRect();
    const copyRect = copy.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    const statusRect = status.getBoundingClientRect();
    const statusStyle = getComputedStyle(status);
    const commandStyle = getComputedStyle(document.querySelector('[data-testid="command-strip"]'));
    const statusRightInset = parseFloat(statusStyle.paddingRight);
    return {
      leftDelta: Math.abs(terminalRect.left - dotRect.left),
      commandLeftInset: parseFloat(commandStyle.paddingLeft),
      // The thing this is meant to check is that the dot sits on the
      // footer text's optical centre. Measure that, rather than the 1px
      // nudge that currently achieves it: the nudge is font-metric and DPI
      // dependent, so pinning it binds the suite to one runner image and
      // goes red on a restyle that keeps the alignment correct.
      dotTextCenterDelta: (() => {
        const text = document.querySelector('[data-testid="statusbar"] .status-left');
        if (!text) return null;
        const t = text.getBoundingClientRect();
        return Math.abs((dotRect.top + dotRect.height / 2) - (t.top + t.height / 2));
      })(),
      leftText: document.querySelector('[data-testid="statusbar"] .status-left')?.textContent ?? '',
      rightText: document.querySelector('[data-testid="statusbar"] .status-right')?.textContent ?? '',
      statusLeftInset: parseFloat(statusStyle.paddingLeft),
      rightDelta: Math.abs(copyRect.right - (statusRect.right - statusRightInset)),
    };
  `);
  assert.ok(state, 'Command and status bars should render');
  assert.ok(
    state.commandLeftInset < state.statusLeftInset,
    `Command prompt icon should sit closer to the edge than the status dot, got ${state.commandLeftInset}/${state.statusLeftInset}px`,
  );
  assert.ok(
    state.dotTextCenterDelta !== null && state.dotTextCenterDelta <= 2,
    `Status dot should sit on the footer text's centre, off by ${state.dotTextCenterDelta}px`,
  );
  assert.match(state.leftText, /Mbps/i, 'Traffic rates should be grouped with the selected interface on the left');
  assert.doesNotMatch(state.rightText, /v\d+\./i, 'Footer should not duplicate the About version');
  assertAlignment('Command copy icon vs status padding', state.rightDelta, 3);
}

async function assertThemedTooltips(driver) {
  const state = await driver.executeScript(`
    const shell = document.querySelector('[data-testid="app-shell"]');
    const nativeTitles = Array.from(shell.querySelectorAll('[title]')).map((item) => item.getAttribute('title'));
    const tooltipCount = shell.querySelectorAll('[data-tooltip]').length;
    const disabledTooltipHost = shell.querySelector('.toolbar button:disabled[data-tooltip]');
    return {
      nativeTitles,
      tooltipCount,
      disabledTooltipHostOpacity: disabledTooltipHost ? getComputedStyle(disabledTooltipHost).opacity : null,
    };
  `);
  assert.equal(state.nativeTitles.length, 0, `Native title tooltips should not be used: ${state.nativeTitles.join(', ')}`);
  assert.ok(state.tooltipCount >= 6, `Expected themed tooltip hooks, got ${state.tooltipCount}`);
  assert.equal(state.disabledTooltipHostOpacity, '1', 'Disabled toolbar buttons should not fade their themed tooltips');
  const runTooltip = await hoverAndReadTooltip(
    driver,
    '[data-testid="run-active-tab"]',
    /Start Scan|Run|Lookup/,
  );
  assert.ok(!runTooltip.error, `Global tooltip should render: ${runTooltip.error}`);
  assert.equal(runTooltip.position, 'fixed', 'Tooltips should be fixed-layer, not clipped by tab overflow');
  assert.ok(runTooltip.zIndex >= 1000, `Tooltip should sit above app overlays, got z-index ${runTooltip.zIndex}`);

  const bounds = await hoverAndReadTooltip(driver, '.detail-actions button:last-child', /details pane/);
  assert.ok(!bounds.error, `Tooltip bounds should be measurable: ${bounds.error}`);
  assert.ok(bounds.left >= 0, `Tooltip should not be clipped on the left: ${bounds.left}`);
  assert.ok(bounds.right <= bounds.viewportWidth, `Tooltip should not be clipped on the right: ${bounds.right}/${bounds.viewportWidth}`);
  assert.ok(bounds.top >= 0, `Tooltip should not be clipped at the top: ${bounds.top}`);
  assert.ok(bounds.bottom <= bounds.viewportHeight, `Tooltip should not be clipped at the bottom: ${bounds.bottom}/${bounds.viewportHeight}`);
}

async function assertInteractiveCursorTreatment(driver) {
  const state = await driver.executeScript(`
    const menu = document.querySelector('.menu-button');
    const run = document.querySelector('[data-testid="run-active-tab"]');
    const add = document.querySelector('.add-tab-main');
    const disabled = document.querySelector('.toolbar button:disabled');
    return {
      menuCursor: menu ? getComputedStyle(menu).cursor : '',
      runCursor: run ? getComputedStyle(run).cursor : '',
      addCursor: add ? getComputedStyle(add).cursor : '',
      disabledCursor: disabled ? getComputedStyle(disabled).cursor : '',
    };
  `);
  assert.equal(state.menuCursor, 'pointer', 'Top-level menu buttons should use a pointer cursor');
  assert.equal(state.runCursor, 'pointer', 'Runnable toolbar actions should use a pointer cursor');
  assert.equal(state.addCursor, 'pointer', 'New-tab actions should use a pointer cursor');
  assert.equal(state.disabledCursor, 'not-allowed', 'Disabled toolbar actions should advertise disabled affordance');
}

/**
 * Hover a control and read its tooltip in ONE round trip.
 *
 * The three-step version of this -- dispatch, `waitForText`, then a separate
 * `executeScript` to measure -- raced and lost. AppTooltip hides 40ms after a
 * `pointerout` (see the close timer in AppTooltip.tsx), and each WebDriver
 * round trip costs far more than 40ms, so anything producing a real pointerout
 * between the wait and the measurement took the tooltip away. The wait passed,
 * the measurement then found nothing, and the failure read as "Global tooltip
 * should render" -- which sounds like the tooltip is broken rather than like a
 * test that looked too late.
 *
 * Everything now happens inside the page: the hover is re-asserted on every
 * animation frame until the text matches, so the hide timer is continually
 * cancelled no matter what triggered it, and the measurement is taken in the
 * same tick as the match. A real failure still reports, and now says what the
 * tooltip actually held.
 */
async function hoverAndReadTooltip(driver, selector, pattern) {
  return driver.executeAsyncScript(
    `
      const selector = arguments[0];
      const source = arguments[1];
      const done = arguments[arguments.length - 1];
      const wanted = new RegExp(source, 'i');
      const control = document.querySelector(selector);
      if (!control) return done({ error: 'no control matching ' + selector });

      const hover = () => {
        const rect = control.getBoundingClientRect();
        const EventCtor = window.PointerEvent ?? MouseEvent;
        control.dispatchEvent(new EventCtor('pointerover', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
        if (typeof control.focus === 'function') control.focus({ preventScroll: true });
      };

      hover();
      const deadline = Date.now() + 4000;
      (function poll() {
        const tooltip = document.querySelector('[data-testid="app-tooltip"]');
        const text = tooltip ? tooltip.textContent || '' : '';
        if (tooltip && wanted.test(text)) {
          const style = getComputedStyle(tooltip);
          const box = tooltip.getBoundingClientRect();
          return done({
            text,
            position: style.position,
            zIndex: Number(style.zIndex),
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          });
        }
        if (Date.now() > deadline) {
          return done({
            error: 'tooltip never matched ' + wanted + '; last text was '
              + (tooltip ? JSON.stringify(text) : '(no tooltip element)'),
          });
        }
        hover();
        requestAnimationFrame(poll);
      })();
    `,
    selector,
    pattern.source,
  );
}

async function assertSuppressesNativeContextMenu(driver) {
  const prevented = await driver.executeScript(`
    const target = document.querySelector('[data-testid="result-table"] tbody td') ?? document.querySelector('[data-testid="result-table"]');
    const rect = target?.getBoundingClientRect();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect ? rect.left + 24 : 24,
      clientY: rect ? rect.top + 24 : 24,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  `);
  assert.equal(prevented, true, 'WebView browser context menu should be suppressed');
  await waitForText(driver, '[data-testid="content-context-menu"]', /Copy (Port|IP|Type|Interface|Host|MAC|Value)/i);
  const copiedCellLabel = await driver.executeScript(`
    const buttons = Array.from(document.querySelectorAll('[data-testid="content-context-menu"] button'));
    const button = buttons.find((item) => /^Copy (?!Selected)/.test(item.textContent.trim()));
    button?.click();
    return button?.textContent.trim() ?? null;
  `);
  assert.ok(copiedCellLabel, 'Context menu should expose a copy action for the clicked cell');
  await waitForText(driver, '.toast', /copied/i);

  const rowMenuPrevented = await driver.executeScript(`
    const target = document.querySelector('[data-testid="result-table"] tbody td') ?? document.querySelector('[data-testid="result-table"]');
    const rect = target?.getBoundingClientRect();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect ? rect.left + 24 : 24,
      clientY: rect ? rect.top + 10 : 24,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  `);
  assert.equal(rowMenuPrevented, true, 'Result cells should reopen the app context menu');
  await waitForText(driver, '[data-testid="content-context-menu"]', /Copy Selected Raw/i);
  const contextMenuText = await driver.findElement(By.css('[data-testid="content-context-menu"]')).getText();
  assert.doesNotMatch(contextMenuText, /Copy CLI Command/i, 'Content context menu should stay scoped to selected content');
  await clickButtonText(driver, '[data-testid="content-context-menu"] button', 'Copy Selected Raw');
  await waitForText(driver, '.toast', /Raw .*copied/i);

  const detailPrevented = await driver.executeScript(`
    const target = document.querySelector('[data-testid="detail-pane"] .detail-body');
    const rect = target?.getBoundingClientRect();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect ? rect.left + 24 : 24,
      clientY: rect ? rect.top + 24 : 24,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  `);
  assert.equal(detailPrevented, true, 'Detail content should use the app context menu');
  await waitForText(driver, '[data-testid="content-context-menu"]', /Copy Selected Details/i);
  await driver.findElement(By.css('.workspace')).click();
  await waitForNoElement(driver, '[data-testid="content-context-menu"]');
}

async function assertToastHasTimeoutBar(driver) {
  const state = await driver.executeScript(`
    const toast = document.querySelector('.toast:not(.persistent)');
    if (!toast) return null;
    const bar = getComputedStyle(toast, '::after');
    return {
      height: bar.height,
      animationName: bar.animationName,
      animationDuration: bar.animationDuration,
    };
  `);
  assert.ok(state, 'Toast should render');
  assert.notEqual(state.animationName, 'none', 'Toast should show a visual timeout bar');
  assert.equal(state.height, '2px', 'Toast timeout bar should be compact');
}

async function dismissDnsWarningIfPresent(driver) {
  const warnings = await driver.findElements(By.css('.warning-strip'));
  if (warnings.length === 0) return;
  await driver.findElement(By.css('[data-testid="dismiss-warning"]')).click();
  await waitForNoElement(driver, '.warning-strip');
}

async function assertOperationToastReturnsToTab(driver, expectedTabText) {
  // The whole point is "switch away, then click the toast to come back", so
  // switching away has to actually happen. `inactiveTab?.click()` swallowed
  // the case where no inactive tab existed, and the final assertion then
  // passed trivially because the expected tab had never been left (M-16).
  const switchedAway = await driver.executeScript(`
    const inactiveTab = document.querySelector('[data-testid="tab-strip"] .work-tab:not(.active)');
    if (!inactiveTab) return false;
    inactiveTab.click();
    return true;
  `);
  assert.ok(
    switchedAway,
    'Expected a second tab to switch away from; without one this scenario cannot fail',
  );
  await waitForText(driver, '[data-testid="toast"]', /complete/i, 25_000);
  await waitForText(driver, '[data-testid="toast"] .toast-action', /Open tab/i);
  await driver.findElement(By.css('[data-testid="toast"]')).click();
  const activeTabText = await getActiveTabText(driver);
  assert.match(activeTabText, expectedTabText, 'Clicking an operation toast should return to its tab');
}

export {
  assertCommandStatusAlignment,
  assertInteractiveCursorTreatment,
  assertOperationToastReturnsToTab,
  assertSuppressesNativeContextMenu,
  assertThemedTooltips,
  assertToastHasTimeoutBar,
  dismissDnsWarningIfPresent,
};
