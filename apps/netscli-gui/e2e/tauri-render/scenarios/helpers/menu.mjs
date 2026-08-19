import assert from 'node:assert/strict';
import { By, Key } from '../../driver.mjs';
import { clickButtonText, waitForText, withElement } from '../../ui.mjs';

async function assertMenuItems(driver, menuLabel, expectedItems) {
  await openMenu(driver, menuLabel);
  const items = await driver.executeScript(
    "return Array.from(document.querySelectorAll('.menu-popover-item')).map((button) => button.textContent.trim());",
  );
  assert.equal(items.length, expectedItems.length, `${menuLabel} menu item count should match`);
  for (const [index, expected] of expectedItems.entries()) {
    if (expected instanceof RegExp) {
      assert.match(items[index], expected, `${menuLabel} menu item ${index} should match`);
    } else {
      assert.equal(items[index], expected, `${menuLabel} menu item ${index} should match`);
    }
  }
  const itemIconCount = await driver.executeScript(
    "return Array.from(document.querySelectorAll('.menu-popover-item')).filter((button) => button.querySelector('svg')).length;",
  );
  assert.equal(itemIconCount, expectedItems.length, `${menuLabel} menu items should have icons`);
}

async function assertMenuIncludes(driver, menuLabel, expectedItems) {
  await openMenu(driver, menuLabel);
  const items = await driver.executeScript(
    "return Array.from(document.querySelectorAll('.menu-popover-item')).map((button) => button.textContent.trim());",
  );
  for (const expected of expectedItems) {
    if (expected instanceof RegExp) {
      assert.ok(items.some((item) => expected.test(item)), `${menuLabel} menu should include ${expected}`);
    } else {
      assert.ok(items.includes(expected), `${menuLabel} menu should include ${expected}`);
    }
  }
}

async function assertMenuKeyboardNavigation(driver) {
  await openMenu(driver, 'File');
  await driver.wait(
    async () =>
      driver.executeScript(
        "return document.activeElement?.matches('.menu-popover-item') && document.activeElement?.textContent.trim() === 'New Port Scan';",
      ),
    5_000,
    'Opening a menu should move focus to the first enabled menu item',
  );
  await driver.actions({ async: true }).sendKeys(Key.ARROW_DOWN).perform();
  const afterArrow = await driver.executeScript("return document.activeElement?.textContent.trim() ?? '';");
  assert.equal(afterArrow, 'Close Current Tab', 'ArrowDown should move menu focus to the next item');
  await driver.actions({ async: true }).sendKeys(Key.ESCAPE).perform();
  await waitForNoElement(driver, '.menu-popover');
}

async function assertEmptyWorkspaceState(driver) {
  await waitForText(driver, '[data-testid="empty-workspace-state"]', /No Tabs Open/i);
  await waitForNoElement(driver, '[data-testid="command-strip"]');
  await waitForNoElement(driver, '.active-form');
  const state = await driver.executeScript(`
    return {
      runDisabled: document.querySelector('[data-testid="run-active-tab"]')?.disabled ?? false,
      exportDisabled: document.querySelector('[data-testid="export-json-button"]')?.disabled ?? false,
      filterDisabled: document.querySelector('[data-testid="result-filter"]')?.disabled ?? false,
      tabCount: document.querySelectorAll('[data-testid="tab-strip"] .work-tab').length,
      status: document.querySelector('[data-testid="statusbar"]')?.textContent ?? '',
    };
  `);
  assert.equal(state.tabCount, 0, 'Empty workspace should have zero tabs');
  assert.equal(state.runDisabled, true, 'Run should be disabled without an active tab');
  assert.equal(state.exportDisabled, true, 'Export should be disabled without an active tab');
  assert.equal(state.filterDisabled, true, 'Filter should be disabled without an active tab');
  assert.match(state.status, /Interface (up|down)/i, 'Empty workspace should keep interface status visible');
  assert.doesNotMatch(state.status, /0 results/i, 'Empty workspace should not show a result summary');
  assert.doesNotMatch(state.status, /v\d+\./i, 'Version should live in About, not the footer');
}

async function assertExitMenuItemNeutralUntilHover(driver) {
  await openMenu(driver, 'File');
  const colors = await driver.executeScript(`
    const items = Array.from(document.querySelectorAll('.menu-popover-item'));
    const normal = items.find((button) => button.textContent.trim() === 'New Port Scan')?.querySelector('svg');
    const exit = items.find((button) => button.textContent.trim() === 'Exit')?.querySelector('svg');
    return {
      normalIcon: normal ? getComputedStyle(normal).color : '',
      exitIcon: exit ? getComputedStyle(exit).color : '',
    };
  `);
  assert.equal(colors.exitIcon, colors.normalIcon, 'Exit icon should be neutral before hover');
  const exitButton = await driver.findElement(By.xpath("//button[contains(@class, 'menu-popover-item') and normalize-space()='Exit']"));
  await driver.actions({ async: true }).move({ origin: exitButton }).perform();
  const hoverColor = await driver.executeScript(`
    const exit = Array.from(document.querySelectorAll('.menu-popover-item'))
      .find((button) => button.textContent.trim() === 'Exit')
      ?.querySelector('svg');
    return exit ? getComputedStyle(exit).color : '';
  `);
  assert.notEqual(hoverColor, colors.exitIcon, 'Exit icon should become danger-colored on hover');
}

async function assertMenuItemDisabled(driver, menuLabel, itemLabel, expected) {
  await openMenu(driver, menuLabel);
  const disabled = await driver.executeScript(
    `
      const item = Array.from(document.querySelectorAll('.menu-popover-item'))
        .find((button) => button.textContent.trim() === arguments[0]);
      if (!item) throw new Error('Missing menu item: ' + arguments[0]);
      return item.disabled;
    `,
    itemLabel,
  );
  assert.equal(disabled, expected, `${menuLabel} > ${itemLabel} disabled state`);
  await closeOpenMenu(driver);
}

async function clickMenuItem(driver, menuLabel, itemLabel) {
  await openMenu(driver, menuLabel);
  await clickButtonText(driver, '.menu-popover-item', itemLabel);
}

async function ensureTrafficIndicatorsVisible(driver) {
  await openSettingsDialog(driver);
  const checked = await driver.executeScript(
    "return document.querySelector('[data-testid=\"settings-activity-animation-toggle\"] input')?.checked === true;",
  );
  if (!checked) {
    await driver.findElement(By.css('[data-testid="settings-activity-animation-toggle"]')).click();
  }
  await closeSettingsDialog(driver);
  await waitForText(driver, '[data-testid="statusbar"]', /Mbps/i);
}

async function assertInterfaceReadinessReflectsSelection(driver) {
  await openSettingsDialog(driver);
  await driver.findElement(By.css('[data-testid="settings-interface-trigger"]')).click();
  await waitForText(driver, '.settings-interface-list', /\S/);
  const selection = await driver.executeScript(`
    const trigger = document.querySelector('[data-testid="settings-interface-trigger"]');
    const originalName = trigger?.getAttribute('data-interface-name') ?? '';
    const originalUp = trigger?.getAttribute('data-interface-up') ?? '';
    const downOption = Array.from(document.querySelectorAll('[data-testid="settings-interface-option"]'))
      .find((button) => button.getAttribute('data-interface-up') === 'false');
    if (!downOption) return { found: false, originalName, originalUp };
    const downName = downOption.getAttribute('data-interface-name') ?? '';
    downOption.click();
    return { found: true, originalName, originalUp, downName };
  `);
  await closeSettingsDialog(driver);
  if (!selection.found) {
    // A genuine skip, but say so. On a runner with a single healthy NIC
    // there is no down interface to select, so this assertion has nothing to
    // exercise -- it used to return silently, which reads in the log exactly
    // like a pass.
    console.log(
      'SKIP assertInterfaceReadinessReflectsSelection: no down interface on this host to select',
    );
    return;
  }
  await waitForText(driver, '[data-testid="statusbar"]', /Interface down/i);

  if (selection.originalName && selection.originalName !== selection.downName) {
    await openSettingsDialog(driver);
    await driver.findElement(By.css('[data-testid="settings-interface-trigger"]')).click();
    await driver.executeScript(`
      const originalName = arguments[0];
      const option = Array.from(document.querySelectorAll('[data-testid="settings-interface-option"]'))
        .find((button) => button.getAttribute('data-interface-name') === originalName);
      option?.click();
    `, selection.originalName);
    await closeSettingsDialog(driver);
    if (selection.originalUp === 'true') {
      await waitForText(driver, '[data-testid="statusbar"]', /Interface up/i);
    }
  }
}

async function openMenu(driver, menuLabel) {
  const activeLabel = await driver.executeScript(`
    const active = document.querySelector('.menu-button.active');
    return active ? active.textContent.trim() : null;
  `);
  if (activeLabel !== menuLabel) {
    await clickButtonText(driver, '.menu-button', menuLabel);
  }
  await driver.wait(
    async () =>
      driver.executeScript(
        "return document.querySelector('.menu-popover') !== null",
      ),
    5_000,
    `Expected ${menuLabel} menu to open`,
  );
}

async function closeOpenMenu(driver) {
  const activeButtons = await driver.findElements(By.css('.menu-button.active'));
  if (activeButtons.length === 0) return;
  await activeButtons[0].click();
  await waitForNoElement(driver, '.menu-popover');
}

async function countTabs(driver) {
  return driver.executeScript("return document.querySelectorAll('[data-testid=\"tab-strip\"] .work-tab').length;");
}

async function getActiveTabText(driver) {
  return driver.executeScript(
    "return document.querySelector('[data-testid=\"tab-strip\"] .work-tab.active')?.textContent.trim() ?? '';",
  );
}

async function waitForTabCount(driver, expected) {
  await driver.wait(
    async () => (await countTabs(driver)) === expected,
    5_000,
    `Expected ${expected} open tabs`,
  );
}

async function waitForNoElement(driver, selector) {
  await driver.wait(
    async () => (await driver.findElements(By.css(selector))).length === 0,
    5_000,
    `Expected no elements matching ${selector}`,
  );
}

async function assertToolbarButtonDisabled(driver, title, expected) {
  const disabled = await driver
    .findElement(By.css(`.toolbar button[aria-label="${title}"]`))
    .getAttribute('disabled');
  assert.equal(disabled === 'true', expected, `Toolbar ${title} disabled state`);
}

export {
  assertEmptyWorkspaceState,
  assertExitMenuItemNeutralUntilHover,
  assertInterfaceReadinessReflectsSelection,
  assertMenuIncludes,
  assertMenuItemDisabled,
  assertMenuItems,
  assertMenuKeyboardNavigation,
  assertToolbarButtonDisabled,
  clickMenuItem,
  countTabs,
  ensureTrafficIndicatorsVisible,
  getActiveTabText,
  openMenu,
  waitForNoElement,
  waitForTabCount,
};
