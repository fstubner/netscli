import assert from 'node:assert/strict';
import { By } from '../../driver.mjs';
import { clickButtonText, waitForNoElement, waitForText, withElement } from '../../ui.mjs';

/**
 * Settings dialog: opening it, asserting its shape, closing it.
 *
 * Split out of menu.mjs, which carried the whole menu bar, the tab helpers,
 * the toolbar and this, and had a standing note to separate the dialog
 * helpers once it next needed changing.
 */

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
  await waitForText(driver, '[data-testid="settings-dialog"]', /Saving/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Ask Where To Save/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Default Save Folder/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Activity Animation/i);
  await waitForText(driver, '[data-testid="settings-dialog"]', /Network Interface/i);
  const text = await driver.findElement(By.css('[data-testid="settings-dialog"]')).getText();
  assert.doesNotMatch(text, /\bNIC\b/i, 'Settings should use Network Interface, not NIC');
  // While it is still open -- this helper closes it at the end.
  await assertSettingsDialogCentring(driver);
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
      checkboxCount: document.querySelectorAll('[data-testid="settings-dialog"] .settings-checkbox-row input[type="checkbox"]').length,
      saveFolderButton: document.querySelector('[data-testid="settings-save-folder-button"]')?.textContent.trim() ?? '',
      saveFolderClearDisabled: document.querySelector('[data-testid="settings-save-folder-clear"]')?.disabled ?? false,
      bodyColumns: body ? getComputedStyle(body).gridTemplateColumns.split(' ').length : 0,
      ratio: dialogRect ? dialogRect.width / dialogRect.height : 0,
      height: dialogRect ? Math.round(dialogRect.height) : 0,
      operationRole: checkbox?.getAttribute('role') ?? '',
      // "Compact square boxes" is the requirement; 18px was one way to
      // satisfy it. Measure squareness and a size range instead, so a font
      // or DPI change does not fail a checkbox that is still both.
      checkboxWidthPx: checkboxBox ? checkboxBox.getBoundingClientRect().width : 0,
      checkboxHeightPx: checkboxBox ? checkboxBox.getBoundingClientRect().height : 0,
      checkboxRadius: checkboxStyle?.borderRadius ?? '',
    };
  `);
  assert.equal(themeControl.role, 'switch', 'Theme selection should be a single toggle switch');
  assert.match(themeControl.text, /Dark|Light/i);
  assert.ok(themeControl.checkboxCount >= 5, 'Non-theme binary preferences should use checkbox controls');
  assert.equal(themeControl.saveFolderButton, 'Choose Folder', 'Default save folder should be configured from Settings');
  assert.equal(themeControl.saveFolderClearDisabled, true, 'Save folder reset should be disabled until a custom folder is selected');
  assert.equal(themeControl.bodyColumns, 1, 'Settings should use a single-column settings flow');
  assert.equal(themeControl.operationRole, '', 'Notification rows should rely on native checkbox semantics');
  assert.ok(themeControl.ratio >= 1.15, `Settings dialog should stay wider than tall, got ratio ${themeControl.ratio}`);
  assert.ok(themeControl.height <= 540, `Settings dialog should stay compact, got ${themeControl.height}px`);
  assert.ok(
    themeControl.checkboxWidthPx >= 14 && themeControl.checkboxWidthPx <= 22,
    `Preference checkboxes should stay compact, got ${themeControl.checkboxWidthPx}px`,
  );
  assert.ok(
    Math.abs(themeControl.checkboxWidthPx - themeControl.checkboxHeightPx) <= 1,
    `Preference checkboxes should be square, got ${themeControl.checkboxWidthPx}x${themeControl.checkboxHeightPx}`,
  );
  assert.ok(['0px', '2px', '3px', '4px'].includes(themeControl.checkboxRadius), 'Preference checkboxes should not look like pill toggles');
  await driver.findElement(By.css('[data-testid="settings-interface-trigger"]')).click();
  await waitForText(driver, '.settings-interface-list', /\S/);
  await waitForText(driver, '.settings-interface-list', /Primary/i);
  await assertInterfacePickerRows(driver);
  await closeSettingsDialog(driver);
}

/**
 * The interface picker's rows, with the dropdown already open.
 *
 * Selection is carried by `aria-selected` and the row highlight. It used to
 * also carry a "Selected" chip, on the one row that was already mint-filled
 * and mint-texted -- three renderings of one fact on a 174px row.
 *
 * The address assertion is the one that matters: each row used to render
 * `ips.slice(0, 2).join(', ')`, so it showed two OS-ordered addresses, and
 * the OS order puts a /128 or a link-local first often enough that the
 * useful address was routinely the one that got cut off. One address, chosen
 * by the user's IPv4/IPv6 preference, is the contract now -- and a comma in
 * that cell is the exact shape of the old bug coming back.
 */
async function assertInterfacePickerRows(driver) {
  const rows = await driver.executeScript(`
    const options = Array.from(document.querySelectorAll('[data-testid="settings-interface-option"]'));
    return options.map((option) => ({
      name: option.getAttribute('data-interface-name') ?? '',
      up: option.getAttribute('data-interface-up') === 'true',
      ariaSelected: option.getAttribute('aria-selected') === 'true',
      text: option.innerText ?? '',
      address: option.querySelector('small')?.innerText ?? '',
    }));
  `);

  assert.ok(rows.length > 0, 'Interface picker should list at least one interface');

  const selected = rows.filter((row) => row.ariaSelected);
  assert.equal(
    selected.length,
    1,
    `Exactly one interface row should be aria-selected, got ${selected.length}`,
  );

  for (const row of rows) {
    assert.ok(
      !/Selected/i.test(row.text),
      `Row "${row.name}" should not carry a "Selected" chip; the highlight and aria-selected say it`,
    );
    assert.ok(
      !row.address.includes(','),
      `Row "${row.name}" should show one address, got "${row.address}"`,
    );
    assert.ok(
      row.address === 'No address' || /\d/.test(row.address),
      `Row "${row.name}" should show an address or say it has none, got "${row.address}"`,
    );
    // "Up" is the unremarkable case and is carried by the dot alone; spelling
    // it out on every row spent width on a word that never varied usefully.
    assert.ok(
      row.up ? !/\bUp\b/.test(row.text) : /\bDown\b/.test(row.text),
      `Row "${row.name}" (${row.up ? 'up' : 'down'}) has the wrong status text: "${row.text}"`,
    );
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
  // A missing close button is a failure, not a no-op.
  //
  // This used to return silently when `.settings-close` was absent, so a
  // dialog that could no longer be dismissed left the suite green -- and
  // every later step ran against a modal that was still open, producing
  // confusing downstream failures instead of naming the real one.
  const closeButtons = await driver.findElements(By.css('.settings-close'));
  assert.ok(closeButtons.length > 0, 'settings dialog has no .settings-close button to dismiss it');
  await closeButtons[0].click();
  await waitForNoElement(driver, '[data-testid="settings-dialog"]');
}

/**
 * The dialog should be centred on the viewport.
 *
 * Not on the workspace region: an earlier version centred it there, on the
 * reasoning that the app draws more chrome above the content than below, and
 * it read as wrong to the person looking at it. This pins the simpler rule
 * so nobody re-derives the clever one.
 */
async function assertSettingsDialogCentring(driver) {
  const geometry = await driver.executeScript(`
    const b = document.querySelector('[data-testid="settings-dialog"]')?.getBoundingClientRect();
    return b ? { top: b.top, bottom: b.bottom, vh: window.innerHeight } : null;
  `);
  assert.ok(geometry, 'settings dialog should be on screen to measure');

  const above = geometry.top;
  const below = geometry.vh - geometry.bottom;
  const drift = Math.abs(above - below);

  assert.ok(
    drift <= 6,
    `settings dialog is ${drift.toFixed(0)}px off the vertical centre of the viewport `
      + `(${above.toFixed(0)}px above, ${below.toFixed(0)}px below).`,
  );
}

export { assertSettingsDialog, assertSettingsDialogCentring, closeSettingsDialog, openSettingsDialog };
