import assert from 'node:assert/strict';

import { By } from '../driver.mjs';
import {
  addToolTab,
  assertNoErrorStrip,
  replaceInput,
  runActiveTool,
  waitForNoElement,
  waitForText,
  withElement,
} from '../ui.mjs';

/**
 * Press Stop on a running operation and check what the app is left claiming.
 *
 * Nothing drove Stop in the app before this, in any test, which is how two
 * defects in the cancel path reached an acceptance review: a run finishing
 * inside the cancel await still took the success path and wrote a result for a
 * run the user had stopped, and a refused cancel was swallowed so the tab went
 * idle over an operation that was still going.
 *
 * The invariant asserted here is the one both violated: after Stop the tab is
 * idle, and no result ever arrives for it. This does not reproduce the first
 * defect's race deterministically -- that needs the run to complete inside the
 * cancel await, which cannot be timed from out here -- but it does pin the
 * behaviour the race produced.
 *
 * 1024 ports on localhost is the load. Deliberately not more: 1025 crosses
 * `LARGE_PORT_CONFIRM_PROBES` and opens the "Confirm Large Port Set" dialog,
 * which swallows the click on Run and leaves this waiting for a run that never
 * started. Measured at ~1.8s of busy on this machine across repeated runs --
 * long enough to reach the Stop button without the test depending on timing.
 *
 * It also makes the after-Stop assertion unambiguous: a run allowed to finish
 * puts 1024 rows on screen, so "no rows" cannot pass by accident.
 */
export async function exerciseCancel(driver) {
  const tabsBefore = await driver.executeScript(
    'return document.querySelectorAll(".work-tab").length;',
  );
  await addToolTab(driver, 'Port Scan');
  await replaceInput(driver, '[data-testid="scan-host-input"]', '127.0.0.1');
  await replaceInput(driver, '[data-testid="result-filter"]', '');
  await replaceInput(driver, '[data-testid="scan-ports-input"]', '1-1024');
  await runActiveTool(driver);

  // The whole test rests on catching the run in flight. `armed` is set from
  // the tab's own busy flag, so waiting for it -- rather than sleeping -- is
  // what stops this passing vacuously against a run that already finished.
  await withElement(driver, '.stop-button.armed', 15_000);

  const beforeStop = await driver.executeScript(`
    return {
      rows: document.querySelectorAll('[data-testid^="result-row-"]').length,
      stopEnabled: !document.querySelector('.stop-button').disabled,
    };`);
  assert.equal(beforeStop.stopEnabled, true, 'Stop should be enabled while a run is in flight');
  assert.equal(beforeStop.rows, 0, 'a run in flight should not have written rows yet');

  // Progress copy carries live counts, which only happens if the operation id
  // reached the backend and registered for progress events. Asserted here
  // because the same missing id broke both: the run could not be cancelled,
  // and its progress sat frozen on its opening message.
  //
  // Waited for rather than sampled: the first progress event lands a beat
  // after the tab goes busy, so reading it the instant Stop arms is a race.
  await waitForText(driver, '.operation-progress', /\d+\s*\/\s*1024/, 8000);

  await driver.findElement(By.css('.stop-button')).click();

  // Busy clears: the tab stops claiming a run is going.
  await waitForNoElement(driver, '.stop-button.armed');

  // A user-initiated stop is not a failure, so nothing should be on the strip.
  await assertNoErrorStrip(driver);

  // And no result may arrive afterwards. This is the assertion that would have
  // caught a stopped run being reported as a completed one.
  const settle = 2500;
  await new Promise((resolve) => setTimeout(resolve, settle));
  const afterStop = await driver.executeScript(`
    const strip = document.querySelector('[data-testid="command-strip"]');
    return {
      rows: document.querySelectorAll('[data-testid^="result-row-"]').length,
      busy: !!document.querySelector('.stop-button.armed'),
      status: (document.querySelector('[data-testid="statusbar"]') || {}).innerText || '',
      command: strip ? strip.innerText : '',
    };`);
  assert.equal(afterStop.busy, false, 'the tab should still be idle after a stop');
  assert.equal(
    afterStop.rows,
    0,
    `a stopped run must not deliver a result; got ${afterStop.rows} row(s) ${settle}ms after Stop `
      + '(this run yields 1024 rows if it is allowed to finish)',
  );
  assert.doesNotMatch(
    afterStop.status,
    /\bRunning\b/i,
    'the status bar should not still report the run as running',
  );

  // Leave the workspace as it was found. A stopped run has no result table,
  // and the light/narrow screenshot passes that follow render whatever tab is
  // active -- so an abandoned tab here changes images that have nothing to do
  // with cancelling.
  await driver.executeScript(`
    const tabs = [...document.querySelectorAll('.work-tab')];
    const active = tabs.find((tab) => tab.classList.contains('active')) ?? tabs[tabs.length - 1];
    active?.querySelector('.tab-close')?.click();`);
  await driver.wait(
    async () =>
      (await driver.executeScript('return document.querySelectorAll(".work-tab").length;')) ===
      tabsBefore,
    5000,
    'the tab opened by the cancel scenario should be closed again',
  );
}
