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
  await waitForText(driver, '.settings-interface-list', /Selected/i);
  await waitForText(driver, '.settings-interface-list', /Primary/i);
  await closeSettingsDialog(driver);
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
 * The dialog should sit at the optical centre of the workspace, not of the
 * window.
 *
 * `.settings-overlay` pads itself by the chrome above and below the content
 * region so the centring box lands on that region. Those paddings are
 * measured constants, so this re-measures them: change the toolbar height
 * and the dialog silently drifts off centre, which is not something anyone
 * notices for months. Comparing against the live chrome rather than against
 * a stored number is what makes this a check rather than a second copy of
 * the same assumption.
 */
async function assertSettingsDialogCentring(driver) {
  const geometry = await driver.executeScript(`
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, height: b.height };
    };
    const dialog = rect('[data-testid="settings-dialog"]');
    const workspace = rect('.workspace') || rect('.main-frame');
    const statusbar = rect('[data-testid="statusbar"]');
    const tabStrip = rect('[data-testid="tab-strip"]');
    return { dialog, workspace, statusbar, tabStrip, viewportHeight: window.innerHeight };
  `);

  assert.ok(geometry.dialog, 'settings dialog should be on screen to measure');
  assert.ok(geometry.tabStrip && geometry.statusbar, 'need the chrome to locate the content region');

  // The content region is whatever sits between the last chrome above it and
  // the status bar below, read from the running app rather than assumed.
  const contentTop = geometry.tabStrip.bottom;
  const contentBottom = geometry.statusbar.top;
  const contentCentre = (contentTop + contentBottom) / 2;
  const dialogCentre = (geometry.dialog.top + geometry.dialog.bottom) / 2;
  const drift = Math.abs(dialogCentre - contentCentre);

  // A few pixels of rounding is fine; the bug this pins was 45px.
  assert.ok(
    drift <= 6,
    `settings dialog is ${drift.toFixed(0)}px off the centre of the content region `
      + `(content ${contentTop.toFixed(0)}..${contentBottom.toFixed(0)}, `
      + `dialog centre ${dialogCentre.toFixed(0)}). The chrome paddings in settings.css `
      + 'are stale -- re-measure them against the current layout.',
  );

  // And it must still fit: a dialog taller than the region it centres on
  // would be clipped at both ends by the chrome.
  assert.ok(
    geometry.dialog.height <= contentBottom - contentTop,
    `settings dialog (${geometry.dialog.height.toFixed(0)}px) is taller than the content region `
      + `(${(contentBottom - contentTop).toFixed(0)}px)`,
  );
}

export { assertSettingsDialog, assertSettingsDialogCentring, closeSettingsDialog, openSettingsDialog };
