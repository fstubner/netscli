import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { artifactsDir } from './paths.mjs';
import { By, until } from './driver.mjs';

export async function withElement(driver, selector, timeoutMs = 10_000) {
  return driver.wait(until.elementLocated(By.css(selector)), timeoutMs);
}

export async function replaceInput(driver, selector, value) {
  const input = await withElement(driver, selector);
  await input.click();
  await driver.executeScript(
    `
      const element = arguments[0];
      const nextValue = arguments[1];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, nextValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    `,
    input,
    '',
  );
  if (value) {
    await input.sendKeys(value);
  }
}

export async function waitForText(driver, selector, pattern, timeoutMs = 10_000) {
  return driver.wait(async () => {
    const elements = await driver.findElements(By.css(selector));
    if (elements.length === 0) return false;
    for (const element of elements) {
      try {
        const text = await element.getText();
        if (pattern.test(text)) return element;
      } catch (error) {
        if (error.name === 'StaleElementReferenceError') return false;
        throw error;
      }
    }
    return false;
  }, timeoutMs, `Expected text matching ${pattern} in ${selector}`);
}

export async function waitForRow(driver, selector, timeoutMs = 20_000) {
  return driver.wait(async () => {
    const elements = await driver.findElements(By.css(selector));
    return elements.length > 0 ? elements[0] : false;
  }, timeoutMs, `Expected row matching ${selector}`);
}

export async function clickButtonText(driver, selector, label) {
  await driver.wait(
    async () =>
      driver.executeScript(
        `
          const selector = arguments[0];
          const label = arguments[1];
          const buttons = Array.from(document.querySelectorAll(selector));
          const button = buttons.find((item) => item.textContent.trim() === label);
          if (!button) return false;
          button.click();
          return true;
        `,
        selector,
        label,
      ),
    5_000,
    `Expected clickable button "${label}" matching ${selector}`,
  );
}

export async function addToolTab(driver, label) {
  const menuLabel = label === 'PCAP' ? 'Packet Capture' : label;
  const scanOperations = new Set(['Port Scan', 'Discover', 'Inspect', 'Sweep']);
  await clickButtonText(driver, '.menu-button', scanOperations.has(menuLabel) ? 'Scan' : 'Tools');
  await clickButtonText(driver, '.menu-popover-item', menuLabel);
}

export async function runActiveTool(driver) {
  await driver.findElement(By.css('[data-testid="run-active-tab"]')).click();
}

export async function assertCommand(driver, pattern) {
  const commandText = await driver.findElement(By.css('[data-testid="command-strip"]')).getText();
  assert.match(commandText, pattern);
}

export async function assertNoErrorStrip(driver) {
  const errors = await driver.findElements(By.css('.error-strip'));
  if (errors.length === 0) return;
  const text = (await errors[0].getText()).trim();
  assert.equal(text, '', `Unexpected UI error: ${text}`);
}

function parseRgb(value) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  assert.ok(match, `Expected CSS rgb() color, got ${value}`);
  return match.slice(1).map(Number);
}

export async function assertTheme(driver, expected) {
  const shell = await withElement(driver, '[data-testid="app-shell"]');
  const className = await shell.getAttribute('class');
  assert.ok(className.includes(`theme-${expected}`), `Expected ${expected} theme class, got "${className}"`);

  const background = await driver.executeScript(
    'return getComputedStyle(document.querySelector(\'[data-testid="app-shell"]\')).backgroundColor',
  );
  const average = parseRgb(background).reduce((sum, value) => sum + value, 0) / 3;
  if (expected === 'dark') {
    assert.ok(average < 90, `Expected a dark app background, got ${background}`);
  } else {
    assert.ok(average > 160, `Expected a light app background, got ${background}`);
  }
}

export async function saveScreenshot(driver, fileName) {
  await fs.promises.mkdir(artifactsDir, { recursive: true });
  let png;
  try {
    const shell = await withElement(driver, '[data-testid="app-shell"]', 1_000);
    png = await shell.takeScreenshot(true);
  } catch {
    png = await driver.takeScreenshot();
  }
  await fs.promises.writeFile(path.join(artifactsDir, fileName), Buffer.from(png, 'base64'));
}

export async function assertNoHorizontalOverflow(driver) {
  const overflow = await driver.executeScript(
    'return document.documentElement.scrollWidth > document.documentElement.clientWidth',
  );
  assert.equal(overflow, false, 'Narrow layout should not create document-level horizontal overflow');
}

export async function captureFailureArtifacts(driver) {
  await saveScreenshot(driver, 'tauri-render-failure.png').catch(() => undefined);
  const bodyText = await driver
    .findElement(By.css('body'))
    .then((body) => body.getText())
    .catch(() => '');
  if (bodyText) {
    console.error(`Rendered app text at failure:\n${bodyText}`);
  }
  const inputState = await driver
    .executeScript(
      "return Array.from(document.querySelectorAll('[data-testid]')).map((element) => [element.getAttribute('data-testid'), element.value || element.textContent?.slice(0, 120) || '']);",
    )
    .catch(() => undefined);
  if (inputState) {
    console.error(`Rendered test id state at failure:\n${JSON.stringify(inputState, null, 2)}`);
  }
}
