import assert from 'node:assert/strict';
import { By } from '../../driver.mjs';
import { assertAlignment } from './alignment.mjs';

async function assertEmptyStateCentered(driver) {
  const state = await driver.executeScript(`
    const region = document.querySelector('.result-region');
    const empty = document.querySelector('.empty-workspace');
    if (!region || !empty) return null;
    const regionRect = region.getBoundingClientRect();
    const emptyRect = empty.getBoundingClientRect();
    const regionCenterX = regionRect.left + regionRect.width / 2;
    const emptyCenterX = emptyRect.left + emptyRect.width / 2;
    return { deltaX: Math.abs(regionCenterX - emptyCenterX) };
  `);
  assert.ok(state, 'Empty state should render');
  assertAlignment('Empty state horizontal centering', state.deltaX, 2);
}

async function forceTabOverflow(driver) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const overflows = await driver.executeScript(`
      const scroll = document.querySelector('[data-testid="tab-strip"] .tab-scroll');
      return scroll ? scroll.scrollWidth > scroll.clientWidth + 1 : false;
    `);
    if (overflows) return;
    await driver.findElement(By.css('.add-tab-main')).click();
    await driver.sleep(50);
  }
}

async function assertAboutDialogPolish(driver) {
  const state = await driver.executeScript(`
    const dialog = document.querySelector('[data-testid="about-dialog"]');
    const close = dialog?.querySelector('.about-close');
    const mark = dialog?.querySelector('.about-mark');
    const github = dialog?.querySelector('.github-icon');
    if (!dialog || !close || !mark || !github) return null;
    const closeRect = close.getBoundingClientRect();
    const closeIconRect = close.querySelector('svg')?.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    const style = getComputedStyle(close);
    const markStyle = getComputedStyle(mark);
    return {
      closeWidth: Math.round(closeRect.width),
      closeHeight: Math.round(closeRect.height),
      closeBackground: style.backgroundColor,
      closeIconDeltaX: closeIconRect
        ? Math.abs((closeRect.left + closeRect.width / 2) - (closeIconRect.left + closeIconRect.width / 2))
        : 999,
      closeIconDeltaY: closeIconRect
        ? Math.abs((closeRect.top + closeRect.height / 2) - (closeIconRect.top + closeIconRect.height / 2))
        : 999,
      markWidth: Math.round(markRect.width),
      markBorderWidth: markStyle.borderTopWidth,
      markTextCount: mark.querySelectorAll('text').length,
      hasGithubIcon: Boolean(github),
    };
  `);
  assert.ok(state, 'About dialog should render');
  assert.ok(state.closeWidth >= 28 && state.closeHeight >= 28, 'About close button should be a usable target');
  assert.notEqual(state.closeBackground, 'rgba(0, 0, 0, 0)', 'About close button should be styled as dialog frame');
  assert.ok(state.closeIconDeltaX <= 1, `About close icon should be horizontally centered, got ${state.closeIconDeltaX}px`);
  assert.ok(state.closeIconDeltaY <= 1, `About close icon should be vertically centered, got ${state.closeIconDeltaY}px`);
  assert.ok(state.markWidth >= 56, `About mark should be large enough, got ${state.markWidth}px`);
  assert.equal(state.markBorderWidth, '0px', 'About logo mark should not have an extra CSS frame');
  assert.equal(state.markTextCount, 6, 'About mark should use the ANSI-shadow NetsCLI N slice');
  assert.equal(state.hasGithubIcon, true, 'About GitHub link should use a GitHub icon');
}

async function assertTrafficArrowsAreLedStyle(driver) {
  const state = await driver.executeScript(`
    return Array.from(document.querySelectorAll('[data-testid="traffic-stats"] .traffic-arrow'))
      .map((arrow) => {
        const style = getComputedStyle(arrow);
        return {
          animationName: style.animationName,
          animationIterationCount: style.animationIterationCount,
          filter: style.filter,
        };
      });
  `);
  assert.ok(state.length >= 2, 'Traffic arrows should render');
  assert.ok(
    state.every((item) => item.filter === 'none'),
    `Traffic arrows should not use glow filters: ${state.map((item) => item.filter).join(', ')}`,
  );
  assert.ok(
    state.every((item) => item.animationName === 'none'),
    `Traffic arrows should represent sampled activity state, not CSS flicker: ${JSON.stringify(state)}`,
  );
}

export {
  assertAboutDialogPolish,
  assertEmptyStateCentered,
  assertTrafficArrowsAreLedStyle,
  forceTabOverflow,
};
