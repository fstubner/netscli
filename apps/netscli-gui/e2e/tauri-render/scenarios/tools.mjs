import assert from 'node:assert/strict';
import { By } from '../driver.mjs';
import { addToolTab, assertCommand, assertNoErrorStrip, clickButtonText, replaceInput, runActiveTool, waitForRow, waitForText, withElement } from '../ui.mjs';
import { dismissDnsWarningIfPresent, assertOperationToastReturnsToTab } from './helpers/interaction.mjs';
import { waitForNoElement } from './helpers/menu.mjs';
import { assertKeyboardSelection } from './helpers/table.mjs';
import { assertFieldSelectPopoverVisible, assertFilterPlaceholder } from './helpers/tabs.mjs';

export async function exerciseDns(driver) {
  await addToolTab(driver, 'DNS Lookup');
  await withElement(driver, '[data-testid="dns-host-input"]');
  await replaceInput(driver, '[data-testid="dns-host-input"]', 'netscli.com');
  await assertCommand(driver, /netscli dns netscli\.com --json/);
  await runActiveTool(driver);
  await waitForText(driver, '[data-testid="statusbar"]', /\d+ records?/i, 25_000);
  await waitForRow(driver, '[data-testid="result-row-dns-0"]', 25_000);
  await waitForText(driver, '[data-testid="result-table"]', /TTL/i);
  await waitForText(driver, '[data-testid="result-table"]', /Resolver/i);
  await assertNoErrorStrip(driver);
  await driver.findElement(By.css('[data-testid="advanced-filter-toggle"]')).click();
  await waitForText(driver, '[data-testid="advanced-filter-menu"]', /Record type/i);
  await waitForText(driver, '[data-testid="advanced-filter-menu"]', /type:A/i);
  const dnsFilterMenuText = await driver.findElement(By.css('[data-testid="advanced-filter-menu"]')).getText();
  assert.doesNotMatch(dnsFilterMenuText, /GitHub Pages/i, 'DNS filter suggestions should be generic, not site-specific');
  await assertFilterPlaceholder(driver, /type:A/i);
  await driver.findElement(By.css('.workspace')).click();
  await waitForNoElement(driver, '[data-testid="advanced-filter-menu"]');
  await dismissDnsWarningIfPresent(driver);
  await replaceInput(driver, '[data-testid="dns-host-input"]', 'example.com');
  await driver.findElement(By.css('[data-testid="dns-record-input"]')).click();
  await waitForText(driver, '.field-select-popover', /AAAA/i);
  await assertFieldSelectPopoverVisible(driver);
  await clickButtonText(driver, '.field-select-popover button', 'AAAA');
  await assertCommand(driver, /netscli dns example\.com --record AAAA --json/);
  await assertNoErrorStrip(driver);
}

export async function exerciseInspect(driver, port) {
  await addToolTab(driver, 'Inspect');
  await withElement(driver, '[data-testid="inspect-host-input"]');
  await replaceInput(driver, '[data-testid="inspect-host-input"]', '127.0.0.1');
  await replaceInput(driver, '[data-testid="inspect-ports-input"]', String(port));
  await assertCommand(driver, new RegExp(`netscli inspect 127\\.0\\.0\\.1 -p ${port} --json`));
  await runActiveTool(driver);
  const rowSelector = `[data-testid="result-row-${port}"]`;
  await waitForText(driver, '[data-testid="statusbar"]', /1 port checked - 1 open/i, 25_000);
  await waitForRow(driver, rowSelector, 25_000);
  await waitForText(driver, '[data-testid="detail-pane"]', /overview/i);
  await waitForText(driver, '[data-testid="detail-pane"]', /Ports Checked/i);
  await waitForText(driver, '[data-testid="detail-pane"]', /Open Ports/i);
  await waitForText(driver, rowSelector, /open/i);
  await assertNoErrorStrip(driver);
}

export async function exerciseDiscover(driver) {
  await addToolTab(driver, 'Discover');
  await withElement(driver, '[data-testid="discover-subnet-input"]');
  await replaceInput(driver, '[data-testid="discover-subnet-input"]', '127.0.0.0/30');
  await assertCommand(driver, /netscli discover 127\.0\.0\.0\/30 --resolve --json/);
  await runActiveTool(driver);
  await assertOperationToastReturnsToTab(driver, /Discover/i);
  await waitForText(driver, '[data-testid="statusbar"]', /\d+ hosts?/i, 25_000);
  await assertNoErrorStrip(driver);
}

export async function exerciseSweep(driver, port) {
  await addToolTab(driver, 'Sweep');
  await withElement(driver, '[data-testid="sweep-subnet-input"]');
  await replaceInput(driver, '[data-testid="sweep-subnet-input"]', '127.0.0.0/30');
  await replaceInput(driver, '[data-testid="sweep-ports-input"]', String(port));
  await assertCommand(driver, new RegExp(`netscli sweep 127\\.0\\.0\\.0\\/30 -p ${port} --resolve --json`));
  await runActiveTool(driver);
  await waitForText(driver, '[data-testid="statusbar"]', /\d+ hosts? .* \d+ with open ports?/i, 30_000);
  await waitForText(driver, '[data-testid="result-table"]', /MAC/i);
  await waitForText(driver, '[data-testid="result-table"]', /RTT/i);
  await assertNoErrorStrip(driver);
}

export async function exerciseInterfaces(driver) {
  await addToolTab(driver, 'Interfaces');
  await withElement(driver, '[data-testid="run-active-tab"]');
  await assertCommand(driver, /netscli interfaces --json/);
  await waitForText(driver, '[data-testid="statusbar"]', /\d+ interfaces?/i, 20_000);
  await waitForRow(driver, '[data-testid^="result-row-iface-"]', 20_000);
  await waitForText(driver, '[data-testid="result-table"]', /App/i);
  await assertKeyboardSelection(driver);
  await assertNoErrorStrip(driver);
}

export async function exerciseArp(driver) {
  await addToolTab(driver, 'ARP Table');
  await withElement(driver, '[data-testid="run-active-tab"]');
  await assertCommand(driver, /netscli arp --json/);
  await waitForText(driver, '[data-testid="statusbar"]', /\d+ ARP entries?/i, 20_000);
  await assertNoErrorStrip(driver);
}

export async function exercisePcapValidation(driver) {
  await clickButtonText(driver, '.menu-button', 'Tools');
  const pcapAvailable = await driver.executeScript(
    "return Array.from(document.querySelectorAll('.menu-popover-item')).some((button) => button.textContent.trim() === 'Packet Capture');",
  );
  if (!pcapAvailable) {
    await driver.findElement(By.css('.workspace')).click();
    await waitForNoElement(driver, '.menu-popover');
    return false;
  }
  await clickButtonText(driver, '.menu-popover-item', 'Packet Capture');
  await withElement(driver, '[data-testid="pcap-interface-input"]');
  const initialCommand = await driver.findElement(By.css('[data-testid="command-strip"]')).getText();
  assert.match(initialCommand, /netscli pcap/);
  if (!/--interface/.test(initialCommand)) {
    await runActiveTool(driver);
    await waitForText(driver, '.error-strip', /Interface is required/i);
    await replaceInput(driver, '[data-testid="pcap-interface-input"]', 'render-test0');
  }
  await replaceInput(driver, '[data-testid="pcap-duration-input"]', '1');
  await replaceInput(driver, '[data-testid="pcap-filter-input"]', 'tcp');
  await replaceInput(driver, '[data-testid="pcap-max_packets-input"]', '1');
  await assertCommand(driver, /netscli pcap --interface .+ --duration 1 --filter "tcp" --max-packets 1/);
  const saveModeControls = await driver.findElements(By.css('[data-testid="pcap-output_mode-input"]'));
  assert.equal(saveModeControls.length, 0, 'Packet Capture save behavior should be configured in Settings');
  await assertNoErrorStrip(driver);
  return true;
}


