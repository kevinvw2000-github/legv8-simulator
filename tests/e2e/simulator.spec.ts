import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Replace the editor contents. */
async function setCode(page: Page, code: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.locator('.cm-content').fill(code);
}

async function registers(page: Page): Promise<Record<string, string>> {
  const rows = await page.locator('#registers tbody tr').all();
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = (await row.locator('th').innerText()).trim();
    out[key] = (await row.locator('td.value').innerText()).trim();
  }
  return out;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('runs the default program to completion', async ({ page }) => {
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.locator('#speed').selectOption('Instant');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#console')).toHaveText('Program finished after 28 steps.');
  await expect(page.locator('#status')).toHaveText('Finished');
  expect((await registers(page)).X0).toBe('21');
  await expect(page.getByRole('button', { name: 'Step' })).toBeDisabled();
});

test('steps one instruction at a time and highlights the current line', async ({ page }) => {
  await setCode(page, 'ADDI X1, XZR, #5\nADDI X2, X1, #1');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(page.locator('.cm-sim-current')).toHaveText('ADDI X1, XZR, #5');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(page.locator('.cm-sim-current')).toHaveText('ADDI X2, X1, #1');
  expect((await registers(page)).X1).toBe('5');
  await expect(page.locator('#registers tr.changed th')).toHaveText('X1');
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
});

test('shows a parse error with the zyBooks message and marks the line', async ({ page }) => {
  await setCode(page, 'ADD X1, X2, X3\nADDI X1, X2, #5000');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(page.locator('#console')).toHaveText('Line 2: 5000 is out of range. Valid range: -1024 to 1023');
  await expect(page.locator('.cm-sim-error')).toHaveText('ADDI X1, X2, #5000');
  await expect(page.locator('#status')).toHaveText('Editing');
});

test('shows a runtime error and keeps the state visible', async ({ page }) => {
  await setCode(page, 'ADDI X2, XZR, #9\nSDIV X1, X2, XZR');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Step' }).click();
  await page.getByRole('button', { name: 'Step' }).click();
  await expect(page.locator('#console')).toHaveText('Error: SDIV X1, X2, XZR. division by zero');
  await expect(page.locator('.cm-sim-error')).toHaveText('SDIV X1, X2, XZR');
  await expect(page.locator('#status')).toHaveText('Error');
  expect((await registers(page)).X2).toBe('9');
});

test('pauses an infinite loop (P8) and can step while paused (P9)', async ({ page }) => {
  await setCode(page, 'Loop:\nADDI X1, X1, #1\nB Loop');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.locator('#speed').selectOption('Instant');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Running');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.locator('#console')).toHaveText('');
  const before = Number((await registers(page)).X1);
  expect(before).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Step' }).click();
  await page.getByRole('button', { name: 'Step' }).click();
  expect(Number((await registers(page)).X1)).toBe(before + 1);
});

test('exit restores the initial values and editing', async ({ page }) => {
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Step' }).click();
  await page.getByRole('button', { name: 'Exit simulation' }).click();
  await expect(page.locator('#status')).toHaveText('Editing');
  await expect(page.locator('#registers tbody tr')).toHaveCount(2);
  await expect(page.locator('#registers tbody tr').first().locator('td input')).toHaveValue('3');
});

test('initial values entered in the panels are used', async ({ page }) => {
  await setCode(page, 'LDUR X1, [X2, #0]');
  await page.getByRole('button', { name: 'Remove X19' }).click();
  await page.locator('#registers tbody tr').first().locator('select').selectOption('X2');
  await page.locator('#registers tbody tr').first().locator('td input').fill('4008');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Step' }).click();
  expect((await registers(page)).X1).toBe('7');
});

test('rejects invalid initial values', async ({ page }) => {
  await page.locator('#registers tbody tr').first().locator('td input').fill('abc');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(page.locator('#console')).toHaveText('Fix the highlighted register or memory values first.');
  await expect(page.locator('#status')).toHaveText('Editing');
});

test('ARM-accurate mode changes quirk results', async ({ page }) => {
  await setCode(page, 'SUBI X1, XZR, #7\nADDI X2, XZR, #2\nSDIV X3, X1, X2');
  await page.locator('#mode').selectOption('arm');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.locator('#speed').selectOption('Instant');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
  expect((await registers(page)).X3).toBe('-3');
});

test('remembers code across reloads', async ({ page }) => {
  await setCode(page, 'ADD X1, X1, X1');
  await page.reload();
  await expect(page.locator('.cm-content')).toHaveText('ADD X1, X1, X1');
});

test('shows the version from package.json', async ({ page }) => {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  await expect(page.locator('.topbar .version')).toHaveText(`v${version}`);
});
