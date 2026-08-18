import assert from 'node:assert/strict';
import { By } from '../driver.mjs';
import { addToolTab, assertCommand, assertNoErrorStrip, clickButtonText, replaceInput, runActiveTool, waitForRow, waitForText, withElement } from '../ui.mjs';
import { dismissDnsWarningIfPresent, assertOperationToastReturnsToTab } from './helpers/interaction.mjs';
import { waitForNoElement } from './helpers/menu.mjs';
import { assertKeyboardSelection } from './helpers/table.mjs';
import { assertFieldSelectPopoverVisible, assertFilterPlaceholder } from './helpers/tabs.mjs';

// Every other scenario here is hermetic against the local probe server; this
// one used to resolve `netscli.com` against real public DNS with a 25s budget
// (B-28), so the suite failed on an air-gapped runner or a slow resolver for
// reasons that had nothing to do with the app.
//
// `localhost` resolves through the system resolver without leaving the host
// and has both A (127.0.0.1) and AAAA (::1) records, so the record-type
// assertions below still exercise what they were written for. Override with
// NETSCLI_E2E_DNS_HOST to point at a real name deliberately.
const DNS_HOST = process.env.NETSCLI_E2E_DNS_HOST || 'localhost';

export async function exerciseDns(driver) {
  await addToolTab(driver, 'DNS Lookup');
  await withElement(driver, '[data-testid="dns-host-input"]');
  await replaceInput(driver, '[data-testid="dns-host-input"]', DNS_HOST);
  await assertCommand(driver, new RegExp(`netscli dns ${escapeRe(DNS_HOST)} --json`));
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
  await replaceInput(driver, '[data-testid="dns-host-input"]', DNS_HOST);
  await driver.findElement(By.css('[data-testid="dns-record-input"]')).click();
  await waitForText(driver, '.field-select-popover', /AAAA/i);
  await assertFieldSelectPopoverVisible(driver);
  await clickButtonText(driver, '.field-select-popover button', 'AAAA');
  await assertCommand(driver, new RegExp(`netscli dns ${escapeRe(DNS_HOST)} --record AAAA --json`));
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
  // At least one, not "0 hosts". 127.0.0.0/30 contains the loopback address
  // the probe server runs on, so a working backend always finds it -- and
  // /\d+ hosts?/ matched "0 hosts", meaning a total Discover regression went
  // green.
  await waitForText(driver, '[data-testid="statusbar"]', /[1-9]\d* hosts?/i, 25_000);
  await assertNoErrorStrip(driver);
}

export async function exerciseSweep(driver, port) {
  await addToolTab(driver, 'Sweep');
  await withElement(driver, '[data-testid="sweep-subnet-input"]');
  await replaceInput(driver, '[data-testid="sweep-subnet-input"]', '127.0.0.0/30');
  await replaceInput(driver, '[data-testid="sweep-ports-input"]', String(port));
  await assertCommand(driver, new RegExp(`netscli sweep 127\\.0\\.0\\.0\\/30 -p ${port} --resolve --json`));
  await runActiveTool(driver);
  // Both counts must be non-zero: the sweep targets the probe server's own
  // port on loopback, so a working backend finds a host and an open port.
  await waitForText(
    driver,
    '[data-testid="statusbar"]',
    /[1-9]\d* hosts? .* [1-9]\d* with open ports?/i,
    30_000,
  );
  await waitForText(driver, '[data-testid="result-table"]', /MAC/i);
  await waitForText(driver, '[data-testid="result-table"]', /RTT/i);
  await assertNoErrorStrip(driver);
}

export async function exerciseInterfaces(driver) {
  await addToolTab(driver, 'Interfaces');
  await withElement(driver, '[data-testid="run-active-tab"]');
  await assertCommand(driver, /netscli interfaces --json/);
  // Every machine has at least a loopback interface, so zero here is a
  // backend failure rather than a legitimate empty result.
  await waitForText(driver, '[data-testid="statusbar"]', /[1-9]\d* interfaces?/i, 20_000);
  await waitForRow(driver, '[data-testid^="result-row-iface-"]', 20_000);
  await waitForText(driver, '[data-testid="result-table"]', /App/i);
  await assertKeyboardSelection(driver);
  await assertNoErrorStrip(driver);
}

export async function exerciseArp(driver) {
  await addToolTab(driver, 'ARP Table');
  await withElement(driver, '[data-testid="run-active-tab"]');
  await assertCommand(driver, /netscli arp --json/);
  // Deliberately still tolerates zero, unlike the assertions above. An empty
  // neighbour cache is a legitimate state on a freshly booted CI runner, so
  // requiring >= 1 here would be flaky rather than strict. A hard backend
  // failure is still caught: the status bar would show an error instead of a
  // count, and assertNoErrorStrip below would fire.
  await waitForText(driver, '[data-testid="statusbar"]', /\d+ ARP entries?/i, 20_000);
  await assertNoErrorStrip(driver);
}

export async function exercisePcapValidation(driver) {
  await clickButtonText(driver, '.menu-button', 'Tools');
  // Packet Capture must always be listed, on every build.
  //
  // This used to `return false` and pass when the menu item was missing, so
  // the entire capture surface disappearing was indistinguishable from a
  // healthy skip. It is now a hard failure: builds without the feature keep
  // the tool visible and show setup guidance instead of hiding it, so an
  // absent entry means something broke.
  const pcapVisible = await driver.executeScript(
    "return Array.from(document.querySelectorAll('.menu-popover-item')).some((button) => button.textContent.trim() === 'Packet Capture');",
  );
  assert.ok(
    pcapVisible,
    'Packet Capture must appear in the Tools menu on every build, with setup guidance when unsupported',
  );
  await clickButtonText(driver, '.menu-popover-item', 'Packet Capture');
  await withElement(driver, '[data-testid="pcap-interface-input"]');
  const unavailable = await driver.findElements(By.css('[data-testid="pcap-unavailable-state"]'));
  if (unavailable.length > 0) {
    // The expected state on a published build. Assert the guidance actually
    // tells the user what to do, rather than just noting the element exists.
    const guidance = await unavailable[0].getText();
    assert.match(guidance, /packet capture/i, 'unavailable state should name the feature');
    assert.match(
      guidance,
      /install|build|support|npcap|libpcap/i,
      'unavailable state should say how to get a capture-capable build, not just that it is missing',
    );
    await assertNoErrorStrip(driver);
    return false;
  }
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

// `localhost` needs no escaping, but NETSCLI_E2E_DNS_HOST may be a real
// domain whose dots would otherwise match any character in the assertion.
function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
