import { expect, test, type Page } from '@playwright/test';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Help' });
const open = (page: Page) => page.getByRole('button', { name: 'Help', exact: true }).click();
const item = (page: Page, op: string) => page.locator(`.help-item[data-op="${op}"]`);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('lists all 47 instructions grouped, and closes with Esc', async ({ page }) => {
  await open(page);
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.help-item')).toHaveCount(47);
  await expect(page.locator('.help-group h3')).toHaveText(['Arithmetic', 'Logic and shifts', 'Load and store', 'Branches', 'Move']);
  await expect(item(page, 'ADDI').locator('.help-syntax')).toHaveText('ADDI Xd, Xn, #imm');
  await expect(item(page, 'ADDI').locator('.help-range')).toHaveText('imm: -1024 to 1023');
  await expect(item(page, 'B.GE').locator('.help-chip')).toHaveText('reads flags');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
});

test('search filters instructions and groups', async ({ page }) => {
  await open(page);
  await page.getByLabel('Search instructions').fill('sdiv');
  await expect(page.locator('.help-item:visible')).toHaveCount(1);
  await expect(page.locator('.help-group:visible')).toHaveCount(1);
  await page.getByLabel('Search instructions').fill('jump if equal');
  await expect(page.locator('.help-item:visible')).toHaveText([/B\.EQ/]);
  await page.getByLabel('Search instructions').fill('zzzz');
  await expect(page.getByText('No instruction matches your search.')).toBeVisible();
});

test('follows the compatibility mode, and can change it', async ({ page }) => {
  await open(page);
  await expect(page.locator('.help-mode-info')).toContainText('Behaves like the zyBooks simulator');
  await expect(item(page, 'SDIV').locator('.help-note')).toContainText('−547608330243');
  await expect(item(page, 'ADD').locator('.help-note')).toHaveCount(0);

  await page.getByLabel('Show how the other mode differs').check();
  await expect(item(page, 'SDIV').locator('.help-note')).toHaveCount(2);
  await expect(item(page, 'SDIV').locator('.help-note-other')).toContainText('ARM-accurate: Real ARM');

  await dialog(page).getByLabel('Compatibility mode').selectOption('arm');
  await expect(page.locator('.help-mode-info')).toContainText('follow real ARM hardware');
  await expect(item(page, 'SDIV').locator('.help-note').first()).toContainText('Real ARM');
  await expect(item(page, 'SDIV').locator('.help-note-other')).toContainText('zyBooks-compatible: zyBooks quirk');
  await expect(page.locator('#mode')).toHaveValue('arm');
  // The top-bar choice is remembered, and Help reflects it next time.
  await page.reload();
  await open(page);
  await expect(dialog(page).getByLabel('Compatibility mode')).toHaveValue('arm');
});

test('the top-bar mode is reflected when Help opens', async ({ page }) => {
  await page.locator('#mode').selectOption('arm');
  await open(page);
  await expect(dialog(page).getByLabel('Compatibility mode')).toHaveValue('arm');
});

test('Insert adds the example line to the code and closes Help', async ({ page }) => {
  await open(page);
  await item(page, 'ADDI').getByRole('button', { name: 'Insert' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('ADDI X1, X2, #1');
  const code = await page.evaluate(() => JSON.parse(localStorage.getItem('legv8-sim:v1')!).code as string);
  expect(code.split('\n')[1]).toBe('ADDI X1, X2, #1'); // after the cursor's line (line 1)
});

test('while simulating: no Insert, the mode is locked, and keys do not reach the simulator', async ({ page }) => {
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await open(page);
  await expect(page.locator('.help-insert')).toHaveCount(0);
  await expect(dialog(page).getByLabel('Compatibility mode')).toBeDisabled();
  await expect(page.locator('.help-mode-info')).toContainText('can’t be changed while simulating');
  await page.keyboard.press('F10');
  await page.keyboard.press('Escape');
  await expect(page.locator('#steps')).toHaveText('0');
});

test('other sections are there', async ({ page }) => {
  await open(page);
  await page.getByText('Not supported (and what to write instead)').click();
  await expect(page.locator('.help-table')).toContainText('SUBS XZR, Xn, Xm');
  await page.getByText('Syntax rules').click();
  await expect(dialog(page)).toContainText('UPPERCASE');
  await page.getByText('Keyboard shortcuts').click();
  await expect(dialog(page).locator('kbd', { hasText: 'F10' })).toBeVisible();
});

test('fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  const box = await dialog(page).boundingBox();
  expect(box!.width).toBeLessThanOrEqual(375);
  const overflow = await page.locator('.help-body').evaluate((b) => b.scrollWidth - b.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Close help' }).click();
  await expect(dialog(page)).toBeHidden();
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(pageOverflow).toBeLessThanOrEqual(0);
});
