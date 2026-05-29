import assert from 'node:assert/strict';
import { By } from '../driver.mjs';
import { assertCommand, assertNoErrorStrip, clickButtonText, replaceInput, runActiveTool, waitForRow, waitForText } from '../ui.mjs';
import { assertAdvancedFilterTopLayer } from './helpers/tabs.mjs';

export async function exerciseScan(driver, port) {
  await replaceInput(driver, '[data-testid="result-filter"]', '');
  await replaceInput(driver, '[data-testid="scan-host-input"]', '127.0.0.1');
  await replaceInput(driver, '[data-testid="scan-ports-input"]', String(port));
  await assertCommand(driver, new RegExp(`netscli scan 127\\.0\\.0\\.1 -p ${port} --json`));
  await runActiveTool(driver);

  const rowSelector = `[data-testid="result-row-${port}"]`;
  await waitForText(driver, '[data-testid="statusbar"]', /1 results? .* 1 open/i);
  await replaceInput(driver, '[data-testid="result-filter"]', '');
  const row = await waitForRow(driver, rowSelector);
  await waitForText(driver, rowSelector, /open/i);

  const rowText = await row.getText();
  assert.match(rowText, new RegExp(String(port)));
  assert.match(rowText, /open/i);
  await row.click();

  await clickButtonText(driver, '.detail-tabs button', 'banner');
  await waitForText(driver, '[data-testid="detail-pane"]', /Service/i);
  await clickButtonText(driver, '.detail-tabs button', 'headers');
  await waitForText(driver, '[data-testid="detail-pane"]', /netscli-e2e/i);
  await clickButtonText(driver, '.detail-tabs button', 'tls');
  await waitForText(driver, '[data-testid="detail-pane"]', /No TLS handshake captured|Protocol/i);
  await clickButtonText(driver, '.detail-tabs button', 'raw');
  await waitForText(driver, '[data-testid="detail-pane"]', /"status": "open"/i);
  const jsonTokenCount = await driver.executeScript(
    "return document.querySelectorAll('[data-testid=\"detail-pane\"] .json-token').length;",
  );
  assert.ok(jsonTokenCount > 5, `Raw JSON should be syntax highlighted, got ${jsonTokenCount} tokens`);

  await replaceInput(driver, '[data-testid="result-filter"]', String(port));
  await waitForRow(driver, rowSelector);
  await replaceInput(driver, '[data-testid="result-filter"]', 'no-match-for-render-test');
  await waitForText(driver, '.empty-filter', /No rows match/i);
  await driver.findElement(By.css('[data-testid="advanced-filter-toggle"]')).click();
  await waitForText(driver, '[data-testid="advanced-filter-menu"]', /Open/i);
  await assertAdvancedFilterTopLayer(driver);
  await clickButtonText(driver, '[data-testid="advanced-filter-menu"] button', 'Openstatus:open');
  await waitForRow(driver, rowSelector);
  await driver.findElement(By.css('[data-testid="advanced-filter-toggle"]')).click();
  await clickButtonText(driver, '[data-testid="advanced-filter-menu"] button', 'All rows*');
  await replaceInput(driver, '[data-testid="result-filter"]', '');
  await waitForRow(driver, rowSelector);
  await assertNoErrorStrip(driver);
}



