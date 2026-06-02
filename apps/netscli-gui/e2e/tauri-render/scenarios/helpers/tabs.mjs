import assert from 'node:assert/strict';
import { By } from '../../driver.mjs';
import { getActiveTabText } from './menu.mjs';

async function assertActiveTabVisible(driver) {
  const visibility = await driver.executeScript(`
    const strip = document.querySelector('[data-testid="tab-strip"] .tab-scroll');
    const tab = document.querySelector('[data-testid="tab-strip"] .work-tab.active');
    if (!strip || !tab) return null;
    const stripRect = strip.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    return {
      left: tabRect.left >= stripRect.left - 1,
      right: tabRect.right <= stripRect.right + 1,
      text: tab.textContent.trim(),
    };
  `);
  assert.ok(visibility, 'Active tab should exist');
  assert.ok(visibility.left && visibility.right, `Active tab should be visible in the strip: ${visibility.text}`);
}

async function assertTabOverflowTreatment(driver) {
  const state = await driver.executeScript(`
    const strip = document.querySelector('[data-testid="tab-strip"]');
    const scroll = strip?.querySelector('.tab-scroll');
    if (!strip || !scroll) return null;
    return {
      className: strip.className,
      overflows: scroll.scrollWidth > scroll.clientWidth + 1,
      scrollbarWidth: getComputedStyle(scroll).scrollbarWidth,
      rightFadeHeight: parseFloat(getComputedStyle(strip, '::after').height || '0'),
      closeWidth: Math.round(
        document.querySelector('[data-testid="tab-strip"] .tab-close')?.getBoundingClientRect().width ?? 0,
      ),
      stripHeight: Math.round(strip.getBoundingClientRect().height),
      tabHeight: Math.round(
        Math.max(
          ...Array.from(strip.querySelectorAll('.work-tab')).map(
            (tab) => tab.getBoundingClientRect().height,
          ),
        ),
      ),
    };
  `);
  assert.ok(state, 'Tab strip should exist');
  assert.equal(state.overflows, true, 'Tab strip should overflow when many tabs are open');
  assert.notEqual(state.scrollbarWidth, 'none', 'Overflowing tabs should expose a scrollbar');
  assert.match(state.className, /has-overflow/, 'Overflowing tabs should expose overflow shadow state');
  assert.ok(state.rightFadeHeight <= 34, `Tab overflow fade should stay above the scrollbar, got ${state.rightFadeHeight}px`);
  assert.ok(state.closeWidth >= 22, `Tab close target should remain usable, got ${state.closeWidth}px`);
  assert.ok(state.stripHeight <= 40, `Tab strip should stay compact, got ${state.stripHeight}px`);
  assert.ok(state.tabHeight <= 38, `Tabs should stay compact, got ${state.tabHeight}px`);
}

async function assertOverflowTabClickSelection(driver) {
  const target = await driver.executeScript(`
    const scroll = document.querySelector('[data-testid="tab-strip"] .tab-scroll');
    const tabs = Array.from(document.querySelectorAll('[data-testid="tab-strip"] .work-tab'));
    if (!scroll || tabs.length < 2) return null;
    scroll.scrollLeft = 0;
    const scrollRect = scroll.getBoundingClientRect();
    const targetIndex = tabs.findIndex((tab) => {
      const rect = tab.getBoundingClientRect();
      return !tab.classList.contains('active') && rect.left >= scrollRect.left && rect.right <= scrollRect.right;
    });
    const index = targetIndex >= 0 ? targetIndex : 0;
    return { index, text: tabs[index].textContent.trim() };
  `);
  assert.ok(target, 'Overflow tab click test should find tabs');
  const tab = await driver.findElement(By.css(`[data-testid="tab-strip"] .work-tab:nth-child(${target.index + 1})`));
  await tab.click();
  await driver.wait(async () => {
    const active = await getActiveTabText(driver);
    return active === target.text;
  }, 5_000, `Clicking overflowed tab should select ${target.text}`);
}

async function assertDetailPaneCanFillWorkspace(driver) {
  await driver.findElement(By.css('.detail-actions button:first-child')).click();
  const state = await driver.executeScript(`
    const workspace = document.querySelector('.workspace');
    const form = document.querySelector('.active-form');
    const result = document.querySelector('.result-region');
    const detail = document.querySelector('[data-testid="detail-pane"]');
    if (!workspace || !form || !result || !detail) return null;
    const workspaceRect = workspace.getBoundingClientRect();
    const detailRect = detail.getBoundingClientRect();
    return {
      detailClass: detail.className,
      formDisplay: getComputedStyle(form).display,
      resultDisplay: getComputedStyle(result).display,
      topDelta: Math.abs(detailRect.top - workspaceRect.top),
      heightRatio: detailRect.height / workspaceRect.height,
    };
  `);
  assert.ok(state, 'Detail pane should be measurable');
  assert.match(state.detailClass, /expanded/, 'Detail pane should enter expanded mode');
  assert.equal(state.formDisplay, 'none', 'Expanded details should hide the form row');
  assert.equal(state.resultDisplay, 'none', 'Expanded details should hide the result region');
  assert.ok(state.topDelta <= 1, `Expanded details should start at workspace top, got ${state.topDelta}px`);
  assert.ok(state.heightRatio > 0.85, `Expanded details should fill the workspace, got ratio ${state.heightRatio}`);
  await driver.findElement(By.css('.detail-actions button:first-child')).click();
}

async function assertTabAddControlPlacement(driver) {
  const state = await driver.executeScript(`
    const strip = document.querySelector('[data-testid="tab-strip"]');
    const scroll = strip?.querySelector('.tab-scroll');
    const lastTab = strip?.querySelector('.work-tab:last-child');
    const add = document.querySelector('[data-testid="tab-strip"] .add-tab-group');
    if (!strip || !scroll || !lastTab || !add) return null;
    const stripRect = strip.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const lastTabRect = lastTab.getBoundingClientRect();
    const addRect = add.getBoundingClientRect();
    const mainButtonRect = add.querySelector('.add-tab-main')?.getBoundingClientRect();
    const chevronButtonRect = add.querySelector('.add-tab-chevron')?.getBoundingClientRect();
    const overflows = scroll.scrollWidth > scroll.clientWidth + 1;
    return {
      overflows,
      addShadow: getComputedStyle(add).boxShadow,
      stripUserSelect: getComputedStyle(strip).userSelect,
      addUserSelect: getComputedStyle(add).userSelect,
      gapFromLastTab: Math.abs(lastTabRect.right - addRect.left),
      rightDelta: Math.abs(stripRect.right - addRect.right),
      scrollBeforeAdd: scrollRect.right <= addRect.left + 1,
      mainCenterDelta: mainButtonRect
        ? Math.abs((mainButtonRect.top + mainButtonRect.height / 2) - (addRect.top + addRect.height / 2))
        : 999,
      chevronCenterDelta: chevronButtonRect
        ? Math.abs((chevronButtonRect.top + chevronButtonRect.height / 2) - (addRect.top + addRect.height / 2))
        : 999,
    };
  `);
  assert.ok(state, 'Tab add control should exist');
  assert.match(state.addShadow, /inset/, 'Tab add control should keep a bottom edge');
  assert.equal(state.stripUserSelect, 'none', 'Tab strip should not select text during drag gestures');
  assert.equal(state.addUserSelect, 'none', 'Tab add control should not select text during drag gestures');
  assert.ok(state.mainCenterDelta <= 1, `New tab button should be vertically centered, got ${state.mainCenterDelta}px`);
  assert.ok(
    state.chevronCenterDelta <= 1,
    `Tool chooser button should be vertically centered, got ${state.chevronCenterDelta}px`,
  );
  if (state.overflows) {
    assert.ok(state.rightDelta <= 2, `Overflowing tab add control should pin to the right edge, got ${state.rightDelta}px`);
    assert.equal(state.scrollBeforeAdd, true, 'Tab overflow should end before the pinned add control');
    return;
  }
  assert.ok(state.gapFromLastTab <= 2, `Non-overflowing tab add control should follow the last tab, got ${state.gapFromLastTab}px`);
}

async function assertTabToolPopoverVisible(driver) {
  const bounds = await driver.executeScript(`
    const popover = document.querySelector('.tab-tool-popover');
    if (!popover) return null;
    const rect = popover.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  `);
  assert.ok(bounds, 'Tab tool popover should exist');
  assert.ok(bounds.left >= 0, `Tab tool popover should not be clipped on the left: ${bounds.left}`);
  assert.ok(bounds.right <= bounds.viewportWidth, `Tab tool popover should not be clipped on the right: ${bounds.right}/${bounds.viewportWidth}`);
  assert.ok(bounds.top >= 0, `Tab tool popover should not be clipped at the top: ${bounds.top}`);
  assert.ok(bounds.bottom <= bounds.viewportHeight, `Tab tool popover should not be clipped at the bottom: ${bounds.bottom}/${bounds.viewportHeight}`);
}

async function assertFieldSelectPopoverVisible(driver) {
  const bounds = await driver.executeScript(`
    const popover = document.querySelector('.field-select-popover');
    if (!popover) return null;
    const rect = popover.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  `);
  assert.ok(bounds, 'Field select popover should exist');
  assert.ok(bounds.left >= 0, `Field select popover should not be clipped on the left: ${bounds.left}`);
  assert.ok(bounds.right <= bounds.viewportWidth, `Field select popover should not be clipped on the right: ${bounds.right}/${bounds.viewportWidth}`);
  assert.ok(bounds.top >= 0, `Field select popover should not be clipped at the top: ${bounds.top}`);
  assert.ok(bounds.bottom <= bounds.viewportHeight, `Field select popover should not be clipped at the bottom: ${bounds.bottom}/${bounds.viewportHeight}`);
}

async function assertTabToolPopoverTopLayer(driver) {
  const state = await driver.executeScript(`
    const popover = document.querySelector('.tab-tool-popover');
    if (!popover) return null;
    const rect = popover.getBoundingClientRect();
    const probeX = rect.left + Math.min(24, rect.width / 2);
    const probeYs = [
      rect.top + 18,
      rect.top + Math.min(90, rect.height / 2),
      rect.bottom - 18,
    ];
    const probes = probeYs.map((probeY) => {
      const topElement = document.elementFromPoint(probeX, probeY);
      return {
        topClass: topElement?.className ?? '',
        insidePopover: Boolean(topElement?.closest('.tab-tool-popover')),
        y: probeY,
      };
    });
    return {
      probes,
    };
  `);
  assert.ok(state, 'Tab tool popover should render');
  for (const probe of state.probes) {
    assert.equal(
      probe.insidePopover,
      true,
      `Tab tool popover should sit above the form layer at y=${probe.y}, top element was ${probe.topClass}`,
    );
  }
}

async function assertEmptyToolLauncherVisible(driver) {
  const state = await driver.executeScript(`
    const popover = document.querySelector('[data-testid="empty-tool-popover"]');
    const tabPopover = document.querySelector('.tab-tool-popover');
    if (!popover) return null;
    const popoverRect = popover.getBoundingClientRect();
    const style = getComputedStyle(popover);
    return {
      hasTabPopover: Boolean(tabPopover),
      position: style.position,
      zIndex: Number(style.zIndex),
      left: popoverRect.left,
      right: popoverRect.right,
      top: popoverRect.top,
      bottom: popoverRect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  `);
  assert.ok(state, 'Empty workspace tool launcher should render');
  assert.equal(state.hasTabPopover, false, 'Empty Choose Tool should not open the tab-strip chevron popover');
  assert.equal(state.position, 'fixed', 'Empty tool launcher should escape the clipped workspace flow');
  assert.ok(state.zIndex >= 1000, `Empty tool launcher should sit on the overlay layer, got z-index ${state.zIndex}`);
  assert.ok(state.left >= 0, `Empty tool launcher should not clip on the left: ${state.left}`);
  assert.ok(state.right <= state.viewportWidth, `Empty tool launcher should not clip on the right: ${state.right}/${state.viewportWidth}`);
  assert.ok(state.top >= 0, `Empty tool launcher should not clip at the top: ${state.top}`);
  assert.ok(state.bottom <= state.viewportHeight, `Empty tool launcher should not clip at the bottom: ${state.bottom}/${state.viewportHeight}`);
}

async function assertAdvancedFilterTopLayer(driver) {
  const state = await driver.executeScript(`
    const popover = document.querySelector('[data-testid="advanced-filter-menu"]');
    if (!popover) return null;
    const rect = popover.getBoundingClientRect();
    const probeX = rect.left + Math.min(28, rect.width / 2);
    const probeY = rect.top + 24;
    const topElement = document.elementFromPoint(probeX, probeY);
    return {
      insidePopover: Boolean(topElement?.closest('[data-testid="advanced-filter-menu"]')),
      topClass: topElement?.className ?? '',
    };
  `);
  assert.ok(state, 'Advanced filter popover should exist');
  assert.equal(
    state.insidePopover,
    true,
    `Advanced filter popover should sit above the tab strip, top element was ${state.topClass}`,
  );
}

async function assertFilterPlaceholder(driver, pattern) {
  const placeholder = await driver.executeScript(
    "return document.querySelector('[data-testid=\"result-filter\"]')?.getAttribute('placeholder') ?? '';",
  );
  assert.match(placeholder, pattern, `Filter placeholder should advertise syntax, got ${placeholder}`);
}


export {
  assertActiveTabVisible,
  assertAdvancedFilterTopLayer,
  assertDetailPaneCanFillWorkspace,
  assertEmptyToolLauncherVisible,
  assertFieldSelectPopoverVisible,
  assertFilterPlaceholder,
  assertOverflowTabClickSelection,
  assertTabAddControlPlacement,
  assertTabOverflowTreatment,
  assertTabToolPopoverTopLayer,
  assertTabToolPopoverVisible,
};
