import assert from 'node:assert/strict';
import { By } from '../../driver.mjs';
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
  assert.match(state.status, /Active|Down/i, 'Empty workspace should keep interface status visible');
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

async function assertSettingsDialog(driver) {
  await openSettingsDialog(driver);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Appearance/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Notifications/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Network Activity/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Theme/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /CLI Command Bar/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Interaction Toasts/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Operation Toasts/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Release Notifications/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Activity Animation/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Network Interface/i);
  const text = await driver.findElement(By.css('[data-testid="settings-dialog"]')).getText();
  assert.doesNotMatch(text, /\bNIC\b/i, 'Settings should use Network Interface, not NIC');
  const themeControl = await driver.executeScript(`
    const control = document.querySelector('[data-testid="settings-theme-toggle"]');
    const dialog = document.querySelector('[data-testid="settings-dialog"]');
    const body = dialog?.querySelector('.settings-dialog-body');
    const dialogRect = dialog?.getBoundingClientRect();
    const checkbox = document.querySelector('[data-testid="settings-operation-toasts-toggle"]');
    const checkboxBox = checkbox?.querySelector('.settings-checkbox-box');
    const checkboxStyle = checkboxBox ? getComputedStyle(checkboxBox) : null;
    return {
      role: control?.getAttribute('role'),
      text: control?.textContent.trim() ?? '',
      checkboxCount: document.querySelectorAll('[data-testid="settings-dialog"] [role="checkbox"]').length,
      bodyColumns: body ? getComputedStyle(body).gridTemplateColumns.split(' ').length : 0,
      ratio: dialogRect ? dialogRect.width / dialogRect.height : 0,
      height: dialogRect ? Math.round(dialogRect.height) : 0,
      operationRole: checkbox?.getAttribute('role') ?? '',
      checkboxWidth: checkboxStyle?.width ?? '',
      checkboxRadius: checkboxStyle?.borderRadius ?? '',
    };
  `);
  assert.equal(themeControl.role, 'switch', 'Theme selection should be a single toggle switch');
  assert.match(themeControl.text, /Dark|Light/i);
  assert.ok(themeControl.checkboxCount >= 4, 'Non-theme binary preferences should use checkbox controls');
  assert.equal(themeControl.bodyColumns, 1, 'Settings should use a single-column settings flow');
  assert.equal(themeControl.operationRole, 'checkbox', 'Notification settings should use checkboxes');
  assert.ok(themeControl.ratio >= 1.15, `Settings dialog should stay wider than tall, got ratio ${themeControl.ratio}`);
  assert.ok(themeControl.height <= 540, `Settings dialog should stay compact, got ${themeControl.height}px`);
  assert.equal(themeControl.checkboxWidth, '18px', 'Preference checkboxes should use compact square boxes');
  assert.ok(['0px', '2px', '3px', '4px'].includes(themeControl.checkboxRadius), 'Preference checkboxes should not look like pill toggles');
  await driver.findElement(By.css('[data-testid="settings-interface-trigger"]')).click();
  await waitForText(driver, '.settings-interface-list', /\S/);
  await waitForText(driver, '.settings-interface-list', /Selected/i);
  await waitForText(driver, '.settings-interface-list', /Default/i);
  await closeSettingsDialog(driver);
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
    "return document.querySelector('[data-testid=\"settings-activity-animation-toggle\"]')?.getAttribute('aria-checked') === 'true';",
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
  if (!selection.found) return;
  await waitForText(driver, '[data-testid="statusbar"]', /\bDown\b/i);

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
      await waitForText(driver, '[data-testid="statusbar"]', /Active/i);
    }
  }
}

async function openSettingsDialog(driver) {
  const open = await driver.executeScript(
    "return document.querySelector('[data-testid=\"settings-dialog\"]') !== null",
  );
  if (!open) {
    await clickButtonText(driver, '.menu-button', 'Settings');
  }
  await withElement(driver, '[data-testid="settings-dialog"]');
}

async function closeSettingsDialog(driver) {
  const closeButtons = await driver.findElements(By.css('.settings-close'));
  if (closeButtons.length > 0) {
    await closeButtons[0].click();
    await waitForNoElement(driver, '[data-testid="settings-dialog"]');
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
  assertSettingsDialog,
  assertToolbarButtonDisabled,
  clickMenuItem,
  closeSettingsDialog,
  countTabs,
  ensureTrafficIndicatorsVisible,
  getActiveTabText,
  openSettingsDialog,
  openMenu,
  waitForNoElement,
  waitForTabCount,
};
