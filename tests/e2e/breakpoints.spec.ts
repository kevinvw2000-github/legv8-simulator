import { expect, test, type Page } from '@playwright/test';

async function setCode(page: Page, code: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.locator('.cm-content').fill(code);
}

/** Click the line number of 1-based `line` to toggle its breakpoint. */
async function toggleBreakpoint(page: Page, line: number) {
  await page.locator('.cm-lineNumbers .cm-gutterElement', { hasText: new RegExp(`^${line}$`) }).click();
}

const reg = (page: Page, name: string) =>
  page.locator(`#registers tbody tr[data-key="${name}"] td.value`);

const LOOP = ['ADDI X1, XZR, #0', 'Loop:', 'ADDI X1, X1, #1', 'SUBIS XZR, X1, #3', 'B.LT Loop', 'ADDI X2, XZR, #9'].join('\n');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await setCode(page, LOOP);
  await page.locator('#speed').selectOption('Instant');
});

test('clicking a line number toggles a breakpoint dot', async ({ page }) => {
  await toggleBreakpoint(page, 3);
  await expect(page.locator('.cm-bp-dot')).toHaveCount(1);
  await toggleBreakpoint(page, 3);
  await expect(page.locator('.cm-bp-dot')).toHaveCount(0);
});

test('Run stops at a breakpoint each loop iteration, then finishes', async ({ page }) => {
  await toggleBreakpoint(page, 3);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  const run = page.getByRole('button', { name: 'Run' });

  await run.click();
  await expect(page.locator('#console')).toHaveText('Paused at breakpoint on line 3.');
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('.cm-sim-current')).toHaveText('ADDI X1, X1, #1');
  await expect(reg(page, 'X1')).toHaveText('0');

  await run.click();
  await expect(reg(page, 'X1')).toHaveText('1');
  await expect(page.locator('#status')).toHaveText('Paused');

  await run.click();
  await expect(reg(page, 'X1')).toHaveText('2');

  await run.click();
  await expect(page.locator('#status')).toHaveText('Finished');
  await expect(reg(page, 'X1')).toHaveText('3');
  await expect(reg(page, 'X2')).toHaveText('9');
});

test('a breakpoint on a label line applies to the next instruction', async ({ page }) => {
  await toggleBreakpoint(page, 2); // "Loop:"
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#console')).toHaveText('Paused at breakpoint on line 3.');
});

test('breakpoints can be added during a paused simulation', async ({ page }) => {
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await toggleBreakpoint(page, 6);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#console')).toHaveText('Paused at breakpoint on line 6.');
  await expect(reg(page, 'X1')).toHaveText('3');
});

test('Clear breakpoints removes them all', async ({ page }) => {
  await toggleBreakpoint(page, 1);
  await toggleBreakpoint(page, 4);
  await page.getByRole('button', { name: 'Clear breakpoints' }).click();
  await expect(page.locator('.cm-bp-dot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
});

test('breakpoints persist across reloads', async ({ page }) => {
  await toggleBreakpoint(page, 4);
  await page.reload();
  await expect(page.locator('.cm-bp-dot')).toHaveCount(1);
});

test('keyboard shortcuts: F10 step, F5 run to breakpoint, F9 toggle', async ({ page }) => {
  await page.locator('.cm-line').nth(4).click(); // cursor on line 5
  await page.keyboard.press('F9');
  await expect(page.locator('.cm-bp-dot')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('#status')).toHaveText('Paused');
  await page.keyboard.press('F10');
  await expect(reg(page, 'X1')).toHaveText('0');
  await page.keyboard.press('F5');
  await expect(page.locator('#console')).toHaveText('Paused at breakpoint on line 5.');
  await expect(reg(page, 'X1')).toHaveText('1');
});

test('Pause during a timed run, then continue', async ({ page }) => {
  await page.locator('#speed').selectOption('Fast');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(reg(page, 'X1')).toHaveText('0'); // first step runs immediately
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await page.locator('#speed').selectOption('Instant');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
});
