import { artifactsDir, npmBin } from './tauri-render/paths.mjs';
import { getFreePort, run, stopProcess } from './tauri-render/processes.mjs';
import { closeServer, startProbeServer } from './tauri-render/probe-server.mjs';
import { By, createDriver, findApplication, resolveNativeDriverPath, startTauriDriver } from './tauri-render/driver.mjs';
import {
  assertNoHorizontalOverflow,
  assertTheme,
  captureFailureArtifacts,
  clickButtonText,
  saveScreenshot,
  withElement,
} from './tauri-render/ui.mjs';
import {
  exerciseArp,
  exerciseDiscover,
  exerciseDns,
  exerciseInspect,
  exerciseInterfaces,
  exerciseMenusAndToolbar,
  exercisePcapValidation,
  exerciseScan,
  exerciseSweep,
} from './tauri-render/scenarios.mjs';

let tauriDriverProcess;
let probeServer;

async function main() {
  let webdriverPort = process.env.TAURI_DRIVER_PORT ? Number(process.env.TAURI_DRIVER_PORT) : 0;
  if (!webdriverPort) {
    webdriverPort = await getFreePort();
  }

  if (process.env.SKIP_TAURI_BUILD !== '1') {
    await run(npmBin, ['exec', '--', 'tauri', 'build', '--debug', '--no-bundle'], {
      env: {
        CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '1',
      },
    });
  } else {
    await run(npmBin, ['run', 'build']);
  }

  const { server, port } = await startProbeServer();
  probeServer = server;

  const nativeDriverPath = await resolveNativeDriverPath();
  const application = findApplication();
  process.env.NETSCLI_EXPORT_DIR = artifactsDir;
  tauriDriverProcess = await startTauriDriver(nativeDriverPath, webdriverPort);

  const driver = await createDriver(webdriverPort, application);

  try {
    await driver.manage().window().setRect({ width: 774, height: 970 });
    await withElement(driver, '[data-testid="app-shell"]', 20_000);

    const shell = await withElement(driver, '[data-testid="app-shell"]');
    if (!(await shell.getAttribute('class')).includes('theme-dark')) {
      await openSettingsDialog(driver);
      await driver.findElement(By.css('[data-testid="settings-theme-toggle"]')).click();
      await closeSettingsDialog(driver);
    }
    await assertTheme(driver, 'dark');
    if ((await driver.findElements(By.css('[data-testid="command-strip"]'))).length === 0) {
      await openSettingsDialog(driver);
      await driver.findElement(By.css('[data-testid="settings-command-bar-toggle"]')).click();
      await closeSettingsDialog(driver);
    }
    await ensureSettingsToggleOn(driver, 'settings-interaction-toasts-toggle');
    await ensureSettingsToggleOn(driver, 'settings-operation-toasts-toggle');
    await ensureSettingsToggleOn(driver, 'settings-release-notifications-toggle');

    await Promise.all([
      withElement(driver, '.menu-strip'),
      withElement(driver, '.toolbar'),
      withElement(driver, '[data-testid="tab-strip"]'),
      withElement(driver, '[data-testid="command-strip"]'),
      withElement(driver, '[data-testid="statusbar"]'),
      withElement(driver, '[data-testid="detail-pane"]'),
    ]);

    await exerciseScan(driver, port);
    await saveScreenshot(driver, 'tauri-render-dark.png');
    await saveScreenshot(driver, 'screen-scan.png');

    await exerciseMenusAndToolbar(driver);
    await saveScreenshot(driver, 'screen-menus-toolbar.png');

    await exerciseDns(driver);
    await saveScreenshot(driver, 'screen-dns.png');

    await exerciseInspect(driver, port);
    await saveScreenshot(driver, 'screen-inspect.png');

    await exerciseDiscover(driver);
    await saveScreenshot(driver, 'screen-discover.png');

    await exerciseSweep(driver, port);
    await saveScreenshot(driver, 'screen-sweep.png');

    await exerciseInterfaces(driver);
    await saveScreenshot(driver, 'screen-interfaces.png');

    await exerciseArp(driver);
    await saveScreenshot(driver, 'screen-arp.png');

    await exercisePcapValidation(driver);
    await saveScreenshot(driver, 'screen-pcap-validation.png');

    await openSettingsDialog(driver);
    await driver.findElement(By.css('[data-testid="settings-theme-toggle"]')).click();
    await closeSettingsDialog(driver);
    await assertTheme(driver, 'light');
    await saveScreenshot(driver, 'tauri-render-light.png');

    await driver.manage().window().setRect({ width: 390, height: 720 });
    await assertNoHorizontalOverflow(driver);
    await withElement(driver, '[data-testid="run-active-tab"]');
    await withElement(driver, '.workspace');
    await withElement(driver, '[data-testid="command-strip"]');
    await withElement(driver, '[data-testid="detail-pane"]');
    await saveScreenshot(driver, 'tauri-render-narrow.png');

    await driver.quit();
  } catch (error) {
    await captureFailureArtifacts(driver);
    await driver.quit().catch(() => undefined);
    throw error;
  }
}

process.on('exit', () => stopProcess(tauriDriverProcess));
process.on('SIGINT', () => {
  stopProcess(tauriDriverProcess);
  process.exit(130);
});

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeServer(probeServer).catch(() => undefined);
    stopProcess(tauriDriverProcess);
  });

async function ensureSettingsToggleOn(driver, testId) {
  await openSettingsDialog(driver);
  const checked = await driver.executeScript(
    "return document.querySelector(`[data-testid=\"${arguments[0]}\"]`)?.getAttribute('aria-checked') === 'true';",
    testId,
  );
  if (!checked) {
    await driver.findElement(By.css(`[data-testid="${testId}"]`)).click();
  }
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
  const closeButtons = await driver.findElements(By.css('.settings-close'));
  if (closeButtons.length > 0) {
    await closeButtons[0].click();
    await driver.wait(
      async () => (await driver.findElements(By.css('[data-testid="settings-dialog"]'))).length === 0,
      5_000,
    );
  }
}
