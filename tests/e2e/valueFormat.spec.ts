import { expect, test, type Page } from '@playwright/test';

async function setCode(page: Page, code: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.locator('.cm-content').fill(code);
}

const value = (page: Page, panel: string, key: string) =>
  page.locator(`#${panel} tbody tr[data-key="${key}"] td.value`);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // X1 = -7, stored to memory 1000.
  await setCode(page, 'SUBI X1, XZR, #7\nADDI X2, XZR, #1000\nSTUR X1, [X2, #0]');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.locator('#speed').selectOption('Instant');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
});

test('defaults to signed decimal', async ({ page }) => {
  await expect(page.getByLabel('Decimal')).toBeChecked();
  await expect(value(page, 'registers', 'X1')).toHaveText('-7');
  await expect(value(page, 'memory', '1000')).toHaveText('-7');
});

test('switches registers, memory and PC between formats', async ({ page }) => {
  await page.getByLabel('Unsigned', { exact: true }).check();
  await expect(value(page, 'registers', 'X1')).toHaveText('18446744073709551609');

  await page.getByLabel('Hex', { exact: true }).check();
  await expect(value(page, 'registers', 'X1')).toHaveText('0xFFFF_FFFF_FFFF_FFF9');
  await expect(value(page, 'registers', 'X2')).toHaveText('0x0000_0000_0000_03E8');
  await expect(value(page, 'memory', '1000')).toHaveText('0xFFFF_FFFF_FFFF_FFF9');

  await page.getByLabel('Binary', { exact: true }).check();
  const bits = (await value(page, 'registers', 'X2').innerText()).split('\n');
  expect(bits).toEqual(['0000 0000 0000 0000 0000 0000 0000 0000', '0000 0000 0000 0000 0000 0011 1110 1000']);

  // Addresses stay decimal.
  await expect(page.locator('#memory tbody tr[data-key="1000"] th')).toHaveText('1000');
  for (const t of await page.locator('#memory tbody tr th').allInnerTexts()) expect(t).toMatch(/^\d+$/);
});

test('PC is shown in hex in hex mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Exit simulation' }).click();
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.locator('#pc')).toHaveText('8');
  await page.getByLabel('Hex', { exact: true }).check();
  await expect(page.locator('#pc')).toHaveText('0x8');
});

test('hovering a value shows every format', async ({ page }) => {
  await expect(value(page, 'registers', 'X1')).toHaveAttribute('title', /Signed: -7\nUnsigned: 18446744073709551609\nHex: 0xFFFF_FFFF_FFFF_FFF9\nBinary: /);
});

test('remembers the choice across reloads', async ({ page }) => {
  await page.getByLabel('Hex', { exact: true }).check();
  await page.reload();
  await expect(page.getByLabel('Hex')).toBeChecked();
});

test('export stays in decimal', async ({ page }) => {
  await page.getByLabel('Hex', { exact: true }).check();
  await page.getByRole('button', { name: 'Exit simulation' }).click();
  await page.getByText('Import / Export').click();
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.locator('#io-text')).not.toHaveValue(/0x/);
});

test('fits a phone screen without sideways scrolling, even in binary', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByLabel('Binary', { exact: true }).check();
  const lines = await value(page, 'registers', 'X2').innerText();
  expect(lines.split('\n')).toHaveLength(4); // 16 bits per line on narrow screens
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
