import assert from 'node:assert/strict';
import { By, Key } from '../driver.mjs';
import { assertCommand, assertNoErrorStrip, assertTheme, clickButtonText, replaceInput, waitForNoElement, waitForText, withElement } from '../ui.mjs';
import { assertExportArtifactsCreated, countExportArtifacts } from './helpers/export.mjs';
import { assertAboutDialogPolish, assertEmptyStateCentered, assertTrafficArrowsAreLedStyle, forceTabOverflow } from './helpers/polish.mjs';
import { assertCommandStatusAlignment, assertInteractiveCursorTreatment, assertSuppressesNativeContextMenu, assertThemedTooltips, assertToastHasTimeoutBar } from './helpers/interaction.mjs';
import { assertEmptyWorkspaceState, assertExitMenuItemNeutralUntilHover, assertInterfaceReadinessReflectsSelection, assertMenuIncludes, assertMenuItemDisabled, assertMenuItems, assertMenuKeyboardNavigation, assertToolbarButtonDisabled, clickMenuItem, countTabs, ensureTrafficIndicatorsVisible, getActiveTabText, waitForTabCount } from './helpers/menu.mjs';
import { assertSettingsDialog, closeSettingsDialog, openSettingsDialog } from './helpers/settingsDialog.mjs';
import { assertActiveTabVisible, assertDetailPaneCanFillWorkspace, assertEmptyToolLauncherVisible, assertOverflowTabClickSelection, assertTabAddControlPlacement, assertTabOverflowTreatment, assertTabToolPopoverTopLayer, assertTabToolPopoverVisible } from './helpers/tabs.mjs';

export async function exerciseMenusAndToolbar(driver) {
  const menuLabels = await driver.executeScript(
    "return Array.from(document.querySelectorAll('.menu-button')).map((button) => button.textContent.trim());",
  );
  assert.deepEqual(menuLabels, ['File', 'Edit', 'Scan', 'Tools', 'History', 'Settings', 'Help']);
  const brandMark = await driver.executeScript(`
    const mark = document.querySelector('.menu-brand-mark svg');
    if (!mark) return null;
    const rect = mark.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      textCount: mark.querySelectorAll('text').length,
      rectCount: mark.querySelectorAll('rect').length,
    };
  `);
  assert.ok(brandMark, 'Menu bar should show the NetsCLI mark next to File');
  assert.equal(brandMark.textCount, 6, 'Menu bar mark should use the ANSI-shadow N slice');
  assert.equal(brandMark.rectCount, 0, 'Menu bar mark should have a transparent background');
  assert.ok(brandMark.width >= 16 && brandMark.height >= 16, 'Menu bar mark should be visible at app frame size');
  const nativeDropdowns = await driver.executeScript(
    "return document.querySelectorAll('select,datalist').length;",
  );
  assert.equal(nativeDropdowns, 0, 'GUI should use app-styled dropdowns instead of native selects/datalists');
  const commandInputAttrs = await driver.executeScript(`
    return ['result-filter', 'scan-host-input', 'scan-ports-input'].map((testId) => {
      const input = document.querySelector('[data-testid="' + testId + '"]');
      return {
        testId,
        spellcheck: input?.getAttribute('spellcheck') ?? '',
        autocorrect: input?.getAttribute('autocorrect') ?? '',
        autocapitalize: input?.getAttribute('autocapitalize') ?? '',
      };
    });
  `);
  for (const attrs of commandInputAttrs) {
    assert.equal(attrs.spellcheck, 'false', `${attrs.testId} should not show browser spellcheck markers`);
    assert.equal(attrs.autocorrect, 'off', `${attrs.testId} should disable autocorrect`);
    assert.equal(attrs.autocapitalize, 'off', `${attrs.testId} should disable autocapitalization`);
  }
  const activeTabTooltip = await driver.executeScript(
    "return document.querySelector('[data-testid=\"tab-strip\"] .work-tab.active')?.getAttribute('data-tooltip') ?? '';",
  );
  assert.match(activeTabTooltip, /Scan/i, 'Tabs should expose compact operation context as themed hover text');
  assert.doesNotMatch(activeTabTooltip, /netscli|--json|<host>/i, 'Tab tooltips should not duplicate the CLI command');
  const activeTabText = await driver.executeScript(
    "return document.querySelector('[data-testid=\"tab-strip\"] .work-tab.active')?.textContent.trim() ?? '';",
  );
  assert.match(activeTabText, /Scan/i, 'Tabs should show the operation label');
  assert.doesNotMatch(activeTabText, /netscli|--json|<host>/i, 'Tabs should not show a full or placeholder CLI command');
  assert.doesNotMatch(activeTabText, /untitled/i);

  await assertMenuIncludes(driver, 'File', [
    'New Port Scan',
    'Close Current Tab',
    'Close Other Tabs',
    'Close All Tabs',
    'Export JSON',
    'Export CSV',
    'Exit',
  ]);
  await assertMenuKeyboardNavigation(driver);
  await assertMenuItems(driver, 'Edit', [
    'Copy CLI Command',
    'Copy Selected Details',
    'Copy Selected Raw',
    'Export Selected JSON',
    'Export Selected CSV',
    'Clear Current Results',
  ]);
  await assertMenuItems(driver, 'Scan', [
    'Run Active Tab',
    'Cancel Active Tab',
    'Port Scan',
    'Ping',
    'Trace Route',
    'Discover',
    'Inspect',
    'Sweep',
  ]);
  await waitForText(driver, '.menu-popover', /Operations/i);
  await assertMenuIncludes(driver, 'Tools', ['DNS Lookup', 'Reverse DNS', 'mDNS Discovery', 'Interfaces', 'ARP Table']);
  await waitForText(driver, '.menu-popover', /Tools and inventory/i);
  await assertMenuItems(driver, 'History', [/netscli scan/i, 'Clear History']);
  await assertSettingsDialog(driver);
  await assertMenuItems(driver, 'Help', ['About NetsCLI']);
  await assertCommandStatusAlignment(driver);
  await assertDetailPaneCanFillWorkspace(driver);
  await assertThemedTooltips(driver);
  await assertInteractiveCursorTreatment(driver);
  await assertSuppressesNativeContextMenu(driver);

  const formActions = await driver.findElements(By.css('.form-row button'));
  assert.equal(formActions.length, 0, 'Form row should not duplicate toolbar actions');
  const activeToolBadges = await driver.findElements(By.css('.active-tool'));
  assert.equal(activeToolBadges.length, 0, 'Form row should not repeat operation icon/name');
  const detailContextText = await driver.executeScript(
    "return document.querySelector('.detail-context')?.textContent.trim() ?? '';",
  );
  assert.doesNotMatch(detailContextText, /^(scan|dns|pcap|inspect|discover|sweep|interfaces|arp)$/i);

  await assertMenuItemDisabled(driver, 'File', 'Export JSON', false);
  await assertMenuItemDisabled(driver, 'File', 'Export CSV', false);
  await assertExitMenuItemNeutralUntilHover(driver);
  await assertMenuItemDisabled(driver, 'History', 'Clear History', false);
  await assertMenuItemDisabled(driver, 'Scan', 'Run Active Tab', false);
  await assertMenuItemDisabled(driver, 'Scan', 'Cancel Active Tab', true);

  const exportBaseline = await countExportArtifacts();
  await clickMenuItem(driver, 'File', 'Export JSON');
  await waitForText(driver, '.toast', /Exported/i);
  await clickMenuItem(driver, 'File', 'Export CSV');
  await waitForText(driver, '.toast', /Exported/i);
  await assertExportArtifactsCreated(exportBaseline);

  await clickMenuItem(driver, 'Edit', 'Copy CLI Command');
  await waitForText(driver, '.toast', /Command copied/i);
  await assertToastHasTimeoutBar(driver);

  await ensureTrafficIndicatorsVisible(driver);
  await assertInterfaceReadinessReflectsSelection(driver);
  await openSettingsDialog(driver);
  await driver.findElement(By.css('[data-testid="settings-activity-animation-toggle"]')).click();
  const statusWithAnimationOff = await driver.findElement(By.css('[data-testid="statusbar"]')).getText();
  assert.match(statusWithAnimationOff, /Mbps/, 'Disabling arrow animation must keep traffic rates visible');
  await withElement(driver, '[data-testid="traffic-stats"]');
  await closeSettingsDialog(driver);
  await openSettingsDialog(driver);
  await driver.findElement(By.css('[data-testid="settings-activity-animation-toggle"]')).click();
  await closeSettingsDialog(driver);
  await waitForText(driver, '[data-testid="statusbar"]', /Mbps/i);
  const trafficMarkup = await driver.executeScript(
    "return document.querySelector('[data-testid=\"statusbar\"] .traffic-stats')?.innerHTML ?? '';",
  );
  assert.doesNotMatch(trafficMarkup, /nic-led/);
  await assertTrafficArrowsAreLedStyle(driver);

  await openSettingsDialog(driver);
  await driver.findElement(By.css('[data-testid="settings-theme-toggle"]')).click();
  await assertTheme(driver, 'light');
  await driver.findElement(By.css('[data-testid="settings-theme-toggle"]')).click();
  await assertTheme(driver, 'dark');
  await closeSettingsDialog(driver);
  await openSettingsDialog(driver);
  await driver.findElement(By.css('[data-testid="settings-command-bar-toggle"]')).click();
  await closeSettingsDialog(driver);
  await waitForNoElement(driver, '[data-testid="command-strip"]');
  await openSettingsDialog(driver);
  await driver.findElement(By.css('[data-testid="settings-command-bar-toggle"]')).click();
  await closeSettingsDialog(driver);
  await withElement(driver, '[data-testid="command-strip"]');

  await clickMenuItem(driver, 'Help', 'About NetsCLI');
  await waitForText(driver, '[data-testid="about-dialog"]', /NetsCLI Desktop/i);
  await waitForText(driver, '[data-testid="about-dialog"]', /Version/i);
  await waitForText(driver, '[data-testid="about-dialog"]', /Felix Stubner/i);
  await waitForText(driver, '[data-testid="about-dialog"]', /GitHub/i);
  await waitForText(driver, '[data-testid="about-dialog"]', /Releases/i);
  await assertAboutDialogPolish(driver);
  await driver.findElement(By.css('.about-close')).click();
  await waitForNoElement(driver, '[data-testid="about-dialog"]');

  let tabCount = await countTabs(driver);
  await driver.findElement(By.css('.add-tab-main')).click();
  await waitForTabCount(driver, tabCount + 1);
  await assertEmptyStateCentered(driver);
  const newScanTabText = await getActiveTabText(driver);
  assert.match(newScanTabText, /Scan/i);
  assert.match(newScanTabText, /127\.0\.0\.1/i, 'New scan tabs should default to the local machine');
  assert.doesNotMatch(newScanTabText, /New|netscli|--json|<host>/i);
  tabCount += 1;

  await clickMenuItem(driver, 'File', 'New Port Scan');
  await waitForTabCount(driver, tabCount + 1);
  tabCount += 1;

  await clickMenuItem(driver, 'File', 'Close Current Tab');
  await waitForTabCount(driver, tabCount - 1);
  tabCount -= 1;

  await assertTabAddControlPlacement(driver);
  await driver.findElement(By.css('.add-tab-chevron')).click();
  await waitForText(driver, '.tab-tool-popover', /DNS Lookup/i);
  await assertTabToolPopoverVisible(driver);
  await assertTabToolPopoverTopLayer(driver);
  await driver.findElement(By.css('.workspace')).click();
  await waitForNoElement(driver, '.tab-tool-popover');

  await driver.findElement(By.css('.add-tab-chevron')).click();
  await waitForText(driver, '.tab-tool-popover', /DNS Lookup/i);
  await assertTabToolPopoverVisible(driver);
  await waitForText(driver, '.tab-tool-popover', /Scan operations/i);
  await waitForText(driver, '.tab-tool-popover', /Lookups and inventory/i);
  await assertTabToolPopoverTopLayer(driver);
  await clickButtonText(driver, '.tab-tool-popover button', 'DNS Lookup');
  await waitForTabCount(driver, tabCount + 1);
  await assertCommand(driver, /netscli dns netscli\.com --json/);
  await assertActiveTabVisible(driver);

  await assertToolbarButtonDisabled(driver, 'Export JSON', true);
  await replaceInput(driver, '[data-testid="dns-host-input"]', '');
  await assertCommand(driver, /netscli dns <host> --json/);
  await driver.findElement(By.css('[data-testid="run-active-tab"]')).click();
  await waitForText(driver, '.error-strip', /Host is required/i);
  await clickMenuItem(driver, 'Scan', 'Run Active Tab');
  await waitForText(driver, '.error-strip', /Host is required/i);
  await clickMenuItem(driver, 'Edit', 'Clear Current Results');
  await assertNoErrorStrip(driver);

  await clickMenuItem(driver, 'History', 'Clear History');
  const historyButtons = await driver.findElements(By.css('.toolbar [data-tooltip*="history" i]'));
  assert.equal(historyButtons.length, 0, 'Toolbar should not expose the removed history flyout');

  await driver.actions({ async: true }).sendKeys(Key.ESCAPE).perform();
  await driver.findElement(By.css('.workspace')).click();
  await waitForNoElement(driver, '.menu-popover');
  await forceTabOverflow(driver);
  await assertTabOverflowTreatment(driver);
  await assertOverflowTabClickSelection(driver);
  await clickMenuItem(driver, 'File', 'Close Other Tabs');
  await waitForTabCount(driver, 1);
  await assertMenuItemDisabled(driver, 'File', 'Close Other Tabs', true);

  await clickMenuItem(driver, 'File', 'Close All Tabs');
  await waitForTabCount(driver, 0);
  await assertEmptyWorkspaceState(driver);
  await assertMenuItemDisabled(driver, 'File', 'Close Current Tab', true);
  await assertMenuItemDisabled(driver, 'File', 'Close All Tabs', true);
  await assertMenuItemDisabled(driver, 'Edit', 'Copy CLI Command', true);
  await assertMenuItemDisabled(driver, 'Scan', 'Run Active Tab', true);

  await driver.findElement(By.css('[data-testid="empty-choose-tool"]')).click();
  await waitForText(driver, '[data-testid="empty-tool-popover"]', /DNS Lookup/i);
  await assertEmptyToolLauncherVisible(driver);
  await driver
    .findElement(By.xpath("//div[@data-testid='empty-tool-popover']//button[normalize-space()='DNS Lookup']"))
    .click();
  await waitForTabCount(driver, 1);
  await assertCommand(driver, /netscli dns netscli\.com --json/);

  await clickMenuItem(driver, 'File', 'Close Current Tab');
  await waitForTabCount(driver, 0);
  await assertEmptyWorkspaceState(driver);
  await driver.findElement(By.css('[data-testid="empty-choose-scan"]')).click();
  await waitForText(driver, '[data-testid="empty-tool-popover"]', /Port Scan/i);
  await assertEmptyToolLauncherVisible(driver);
  await clickButtonText(driver, '[data-testid="empty-tool-popover"] button', 'Port Scan');
  await waitForTabCount(driver, 1);
  await waitForText(driver, '[data-testid="tab-strip"] .work-tab.active', /Scan/i);
}



