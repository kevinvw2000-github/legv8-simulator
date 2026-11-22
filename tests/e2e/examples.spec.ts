import { expect, test, type Page } from '@playwright/test';

const KEY = 'legv8-sim:v1';
const MINE = 'ADD X9, X9, X9 // my own program';

async function load(page: Page, mode = 'zybooks') {
  await page.goto('/');
  await page.evaluate(
    ([k, s]) => localStorage.setItem(k as string, JSON.stringify(s)),
    [
      KEY,
      {
        code: MINE, registers: [{ key: 'X5', value: '7' }], memory: [], speed: 'Instant', mode, format: 'signed',
        breakpoints: [], watches: [{ label: 'mine', address: '800', count: 1 }], expected: {},
      },
    ],
  );
  await page.reload();
}

const menu = (page: Page) => page.locator('#examples');
const pick = (page: Page, id: string) => menu(page).selectOption({ value: id });
const banner = (page: Page) => page.getByRole('region', { name: 'Shared program' });
const step = (page: Page) => page.getByRole('button', { name: 'Step', exact: true });
const enter = (page: Page) => page.getByRole('button', { name: 'Enter simulation' }).click();
const expectedCell = (page: Page, reg: string) => page.locator(`#registers tr[data-key="${reg}"] td.col-expected`);

test('the menu lists the examples by group', async ({ page }) => {
  await load(page);
  await expect(menu(page).locator('option').first()).toHaveText('Examples');
  const groups = await menu(page).locator('optgroup').evaluateAll((els) => els.map((e) => (e as HTMLOptGroupElement).label));
  expect(groups).toEqual(['Basics', 'Numbers and bits', 'Memory', 'Procedures', 'Debugging', 'Full LEGv8']);
  await expect(menu(page).locator('option')).toHaveCount(13); // the label plus 12 examples
  await expect(menu(page).locator('optgroup[label="Procedures"] option')).toHaveText([
    'A simple procedure call',
    'Recursion: power of 2',
    'Bug: forgetting to save X30',
    'The fix: saving X30',
    'Bug: stack pointer never set',
  ]);
});

test('loading an example brings its code, values, watches and expected results, and keeps your work', async ({ page }) => {
  await load(page, 'arm');
  await pick(page, 'sum-array');
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText(
    "You're viewing the example “Sum an array”, which switches Compatibility to zyBooks-compatible. Your own program is safe; Keep it replaces it with this one.",
  );
  await expect(menu(page)).toHaveValue(''); // the menu goes back to its label
  await expect(page.locator('.cm-content')).toContainText('Sum X19 doublewords');
  await expect(page.locator('#registers tbody tr')).toHaveCount(2);
  await expect(page.locator('#memory tbody tr')).toHaveCount(3);
  await expect(page.locator('#watch .watch-label')).toHaveText('array');
  await expect(page.locator('#expected summary')).toHaveText('Expected results (1)');
  await expect(page.locator('#mode')).toHaveValue('zybooks');
  await expect(page.locator('#console')).toContainText('Example: Sum an array.');

  await enter(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
  await expect(expectedCell(page, 'X0')).toHaveText('✓ 21');
  await expect(page.locator('#console')).toContainText('Expected value matches.');
  await expect(menu(page)).toBeDisabled(); // not while simulating
  await page.getByRole('button', { name: 'Exit simulation' }).click();
  await expect(menu(page)).toBeEnabled();

  // Your own work is untouched in storage, and comes back on request.
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), KEY);
  expect(saved.code).toBe(MINE);
  expect(saved.mode).toBe('arm');
  await page.getByRole('button', { name: 'Back to my program' }).click();
  await expect(banner(page)).toBeHidden();
  await expect(page.locator('.cm-content')).toHaveText(MINE);
  await expect(page.locator('#mode')).toHaveValue('arm');
  await expect(page.locator('#watch .watch-label')).toHaveText('mine');
  await expect(page.locator('#expected summary')).toHaveText('Expected results ');
});

test('Keep it saves the example; otherwise a reload brings your own program back', async ({ page }) => {
  await load(page);
  await pick(page, 'add');
  await page.reload();
  await expect(banner(page)).toBeHidden();
  await expect(page.locator('.cm-content')).toHaveText(MINE);

  await pick(page, 'add');
  await page.getByRole('button', { name: 'Keep it' }).click();
  await expect(banner(page)).toBeHidden();
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Add and subtract two numbers');
  await expect(page.locator('#registers tbody tr')).toHaveCount(2);
});

test('opening another example keeps the original program safe', async ({ page }) => {
  await load(page);
  await pick(page, 'add');
  await pick(page, 'reverse-array');
  await expect(page.locator('.cm-content')).toContainText('Copy an array in reverse order');
  await expect(page.locator('#watch .watch-label')).toHaveText(['source', 'reversed']);
  await page.getByRole('button', { name: 'Back to my program' }).click();
  await expect(page.locator('.cm-content')).toHaveText(MINE);
});

test('off by one: ends with a wrong total that the Expected column flags', async ({ page }) => {
  await load(page);
  await pick(page, 'bug-off-by-one');
  await expect(page.locator('.cm-bp-dot')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear breakpoints' }).click();
  await enter(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
  await expect(expectedCell(page, 'X0')).toHaveText('✗ 24');
  await expect(page.locator('#console')).toContainText('Expected values: 0 of 1 match. X0 is 1024, expected 24.');
});

test('off by one: the breakpoint stops Run on the load', async ({ page }) => {
  await load(page);
  await pick(page, 'bug-off-by-one');
  await enter(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('.cm-sim-current')).toContainText('LDUR X3, [X2, #0]');
});

test('stack pointer never set: stops with the invalid-address error', async ({ page }) => {
  await load(page);
  await pick(page, 'bug-sp');
  await enter(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Error');
  await expect(page.locator('#console')).toHaveText(
    'Error: STUR X30, [X28, #8]. Invalid address: 18446744073709551608\n(That address is -8 as a signed value.)',
  );
  await expect(page.locator('.calls .stack-problem')).toContainText('X28 (SP) is -16');
});

test('forgetting X30: the call stack warns after the bad return', async ({ page }) => {
  await load(page);
  await pick(page, 'bug-save-lr');
  await enter(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('#console')).toHaveText('Paused at breakpoint on line 10.');
  await expect(page.locator('.calls .call-warning')).toHaveCount(0);
  await step(page).click(); // the BR X30 that goes to the wrong place
  await expect(page.locator('.calls .call-warning')).toContainText('BR X30 went to line 10 (0x14), but Outer should return to line 6 (0x8).');
});

test('the fix finishes cleanly with no warning', async ({ page }) => {
  await load(page);
  await pick(page, 'fix-save-lr');
  await enter(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
  await expect(page.locator('.calls .call-warning')).toHaveCount(0);
  await expect(expectedCell(page, 'X0')).toHaveText('✓ 3');
  await expect(expectedCell(page, 'X28')).toHaveText('✓ 8000');
});

test('the textbook example switches to Full LEGv8, and Back restores your mode', async ({ page }) => {
  await load(page);
  await pick(page, 'textbook-full');
  await expect(banner(page)).toContainText('which switches Compatibility to Full LEGv8');
  await expect(page.locator('#mode')).toHaveValue('full');
  await expect(page.locator('#mode-badge')).toBeVisible();
  await enter(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
  await expect(page.locator('#console')).toContainText('Expected values: all 4 match.');
  await page.getByRole('button', { name: 'Exit simulation' }).click();
  await page.getByRole('button', { name: 'Back to my program' }).click();
  await expect(page.locator('#mode')).toHaveValue('zybooks');
  await expect(page.locator('#mode-badge')).toBeHidden();
});

test('the menu fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  await pick(page, 'recursion-pow2');
  await expect(banner(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
