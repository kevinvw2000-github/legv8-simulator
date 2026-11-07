import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByText('Import / Export').click();
});

test('export writes the zyBooks format for the current workspace', async ({ page }) => {
  await page.getByRole('button', { name: 'Export' }).click();
  const data = JSON.parse(await page.locator('#io-text').inputValue());
  expect(data.registers).toBe('X19 3, X20 4000');
  expect(data.memory).toBe('4000 5, 4008 7, 4016 9');
  expect(data.code).toContain('LDUR X3, [X2, #0]');
});

test('import replaces code and values after confirmation', async ({ page }) => {
  const text = JSON.stringify({ code: 'LDUR X1, [X2, #0]', registers: 'X2 6000', memory: '6000 42' });
  await page.locator('#io-text').fill(text);
  const importButton = page.locator('#import');
  await importButton.click();
  await expect(importButton).toHaveText('Replace code and values?');
  await importButton.click();
  await expect(page.locator('#console')).toHaveText('Imported.');
  await expect(page.locator('.cm-content')).toHaveText('LDUR X1, [X2, #0]');

  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.locator('#registers tbody tr[data-key="X1"] td.value')).toHaveText('42');
});

test('import shows the zyBooks error for bad input', async ({ page }) => {
  await page.locator('#io-text').fill('{"registers":"X99 1"}');
  await page.locator('#import').click();
  await page.locator('#import').click();
  await expect(page.locator('#console')).toHaveText('Registers format or naming invalid.');
});

test('reset restores the demo program', async ({ page }) => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('ADD X1, X1, X1');
  await page.locator('#reset').click();
  await page.locator('#reset').click();
  await expect(page.locator('#console')).toHaveText('Reset to the demo program.');
  await expect(page.locator('.cm-content')).toContainText('Sum X19 doublewords');
});

test('import/export is disabled during simulation', async ({ page }) => {
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(page.locator('#import')).toBeDisabled();
  await expect(page.locator('#reset')).toBeDisabled();
});
