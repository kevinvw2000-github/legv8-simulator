import { expect, test, type Page } from '@playwright/test';

async function setCode(page: Page, code: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.locator('.cm-content').fill(code);
}

const reg = (page: Page, name: string) => page.locator(`#registers tbody tr[data-key="${name}"] td.value`);
const back = (page: Page) => page.getByRole('button', { name: 'Step back' });
const step = (page: Page) => page.getByRole('button', { name: 'Step', exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('undoes steps one at a time, restoring values and the current line', async ({ page }) => {
  await setCode(page, 'ADDI X1, XZR, #5\nADDI X1, X1, #10\nADDI X2, X1, #1');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(back(page)).toBeDisabled();

  await step(page).click();
  await step(page).click();
  await expect(reg(page, 'X1')).toHaveText('15');
  await expect(page.locator('#steps')).toHaveText('2');

  await back(page).click();
  await expect(reg(page, 'X1')).toHaveText('5');
  await expect(page.locator('#steps')).toHaveText('1');
  await expect(page.locator('.cm-sim-current')).toHaveText('ADDI X1, X1, #10');
  await expect(page.locator('#console')).toHaveText('Stepped back to line 2.');

  await back(page).click();
  await expect(reg(page, 'X1')).toHaveCount(0); // X1 hadn't been touched yet
  await expect(back(page)).toBeDisabled();

  // Stepping forward again gives the same results.
  await step(page).click();
  await step(page).click();
  await expect(reg(page, 'X1')).toHaveText('15');
});

test('Ctrl+Z steps back while simulating', async ({ page }) => {
  await setCode(page, 'ADDI X1, XZR, #5\nADDI X1, X1, #10');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await step(page).click();
  await step(page).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(reg(page, 'X1')).toHaveText('5');
});

test('Ctrl+Z still undoes typing while editing', async ({ page }) => {
  await setCode(page, 'ADD X1, X1, X1');
  await page.keyboard.type(' // hi');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.cm-content')).not.toContainText('// hi');
});

test('steps back from the end of a finished program', async ({ page }) => {
  await setCode(page, 'ADDI X1, XZR, #5\nADDI X1, X1, #10');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.locator('#speed').selectOption('Instant');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
  await back(page).click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(reg(page, 'X1')).toHaveText('5');
  await expect(step(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
});

test('steps back out of a runtime error', async ({ page }) => {
  await setCode(page, 'ADDI X1, XZR, #5\nSDIV X2, X1, XZR');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await step(page).click();
  await step(page).click();
  await expect(page.locator('#status')).toHaveText('Error');
  await expect(page.locator('.cm-sim-error')).toHaveCount(1);

  await back(page).click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('.cm-sim-error')).toHaveCount(0);
  await expect(page.locator('.cm-sim-current')).toHaveText('SDIV X2, X1, XZR');
  await expect(reg(page, 'X1')).toHaveText('5');
});

test('is disabled while running', async ({ page }) => {
  await setCode(page, 'Loop:\nADDI X1, X1, #1\nB Loop');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.locator('#speed').selectOption('Slow');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(back(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(back(page)).toBeEnabled();
});
