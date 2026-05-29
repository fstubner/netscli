import assert from 'node:assert/strict';
import { By, Key } from '../../driver.mjs';
import { waitForText } from '../../ui.mjs';

async function assertKeyboardSelection(driver) {
  const rowCount = await driver.executeScript(`
    const rows = document.querySelectorAll('[data-testid="result-table"] tbody tr');
    return rows.length;
  `);
  assert.ok(rowCount > 1, 'Keyboard selection test needs multiple rows');
  const table = await driver.findElement(By.css('[data-testid="result-table"]'));
  await driver.executeScript("document.querySelector('[data-testid=\"result-table\"]')?.focus();");
  const tableUserSelect = await driver.executeScript(`
    return getComputedStyle(document.querySelector('[data-testid="result-table"]')).userSelect;
  `);
  assert.equal(tableUserSelect, 'none', 'Result table should not select text during keyboard row selection');
  await driver.executeScript(`
    const table = document.querySelector('[data-testid="result-table"]');
    window.getSelection()?.removeAllRanges();
    table?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
  `);
  const allSelected = await driver.executeScript(`
    return Array.from(document.querySelectorAll('[data-testid="result-table"] tbody tr'))
      .filter((row) => row.classList.contains('selected')).length;
  `);
  const selectedDocumentText = await driver.executeScript("return window.getSelection()?.toString() ?? '';");
  assert.equal(allSelected, rowCount, 'Ctrl+A in the result table should select all rows');
  assert.equal(selectedDocumentText, '', 'Ctrl+A in the result table should not select page text');
  const before = await driver.executeScript(`
    return Array.from(document.querySelectorAll('[data-testid="result-table"] tbody tr'))
      .findIndex((row) => row.classList.contains('selected'));
  `);
  await table.sendKeys(Key.ARROW_DOWN);
  const afterDown = await driver.executeScript(`
    return Array.from(document.querySelectorAll('[data-testid="result-table"] tbody tr'))
      .findIndex((row) => row.classList.contains('selected'));
  `);
  assert.equal(afterDown, Math.min(before + 1, rowCount - 1), 'ArrowDown should select the next row');
  await table.sendKeys(Key.END);
  const afterEnd = await driver.executeScript(`
    return Array.from(document.querySelectorAll('[data-testid="result-table"] tbody tr'))
      .findIndex((row) => row.classList.contains('selected'));
  `);
  assert.equal(afterEnd, rowCount - 1, 'End should select the last row');
  await driver.executeScript(`
    const table = document.querySelector('[data-testid="result-table"]');
    table?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
  `);
  const rangeSelection = await driver.executeScript(`
    return Array.from(document.querySelectorAll('[data-testid="result-table"] tbody tr'))
      .filter((row) => row.classList.contains('selected')).length;
  `);
  assert.ok(rangeSelection >= 2, `Shift+Arrow should extend the row selection, got ${rangeSelection}`);
  await waitForText(driver, '[data-testid="statusbar"]', new RegExp(`${rangeSelection} of ${rowCount} selected`, 'i'));
  const detailTabs = await driver.executeScript(`
    return Array.from(document.querySelectorAll('[data-testid="detail-pane"] .detail-tabs button'))
      .map((button) => button.textContent.trim())
      .filter(Boolean);
  `);
  assert.deepEqual(detailTabs, ['selection', 'raw'], 'Multi-row selections should use aggregate detail tabs');
  await waitForText(driver, '[data-testid="detail-pane"]', /\d+ selected/i);
  await waitForText(driver, '[data-testid="detail-pane"]', /Selected Rows/i);
  const detailSelection = await driver.executeScript(`
    const detailBody = document.querySelector('[data-testid="detail-pane"] .detail-body');
    if (!detailBody) return '';
    detailBody.focus();
    detailBody.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    return window.getSelection()?.toString() ?? '';
  `);
  assert.match(detailSelection, /Selected Rows/i, 'Ctrl+A in detail panes should select only detail pane text');
  assert.doesNotMatch(detailSelection, /Start Scan|File|Settings/i, 'Detail Ctrl+A should not select app frame text');
  if (rowCount > 2) {
    await driver.executeScript(`
      const rows = document.querySelectorAll('[data-testid="result-table"] tbody tr');
      rows[0]?.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true }));
    `);
    const toggleSelection = await driver.executeScript(`
      return Array.from(document.querySelectorAll('[data-testid="result-table"] tbody tr'))
        .filter((row) => row.classList.contains('selected')).length;
    `);
    assert.ok(toggleSelection >= rangeSelection, 'Ctrl+click should add an individual row without clearing the range');
  }
}

export { assertKeyboardSelection };
