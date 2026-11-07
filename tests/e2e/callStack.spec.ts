import { expect, test, type Page } from '@playwright/test';

const POW2 = [
  'ADDI X0, XZR, #3', 'BL pow2', 'B done', 'pow2:', 'SUBI X28, X28, #16', 'STUR X30, [X28, #8]',
  'STUR X0, [X28, #0]', 'CBZ X0, base', 'SUBI X0, X0, #1', 'BL pow2', 'LSL X1, X1, #1', 'B ret',
  'base:', 'ADDI X1, XZR, #1', 'ret:', 'LDUR X0, [X28, #0]', 'LDUR X30, [X28, #8]',
  'ADDI X28, X28, #16', 'BR X30', 'done:',
].join('\n');

/** Load a workspace directly (faster and more exact than typing it). */
async function load(page: Page, code: string, registers: { key: string; value: string }[], breakpoints: number[] = []) {
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('legv8-sim:v1', JSON.stringify(s)),
    { code, registers, memory: [], speed: 'Instant', mode: 'zybooks', format: 'signed', breakpoints },
  );
  await page.reload();
}

const frames = (page: Page) => page.locator('.calls .frames .frame-label');
const step = (page: Page) => page.getByRole('button', { name: 'Step', exact: true });

test('shows a hint while editing', async ({ page }) => {
  await load(page, POW2, []);
  await expect(page.locator('#calls')).toHaveText('Calls made with BL appear here while simulating.');
});

test('shows recursive calls and the stack frames they saved', async ({ page }) => {
  await load(page, POW2, [{ key: 'X28', value: '8000' }], [14]);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Paused');

  await expect(frames(page)).toHaveText(['pow2', 'pow2', 'pow2', 'pow2']);
  await expect(page.locator('.calls .frame-depth')).toHaveText(['call 4', 'call 3', 'call 2', 'call 1']);
  await expect(page.locator('.calls .frame-meta').first()).toHaveText('called from line 10 · returns to line 11 (0x24)');
  await expect(page.locator('.calls .stack-meta')).toHaveText('SP (X28) = 7936 · top 8000');

  const sp = page.locator('.stack-table tr.stack-sp');
  await expect(sp.locator('th')).toHaveText('7936SP');
  await expect(sp.locator('.stack-note')).toHaveText('saved X0 (line 7)');
  await expect(page.locator('.stack-table tr[data-address="7992"] .stack-note')).toHaveText('saved X30 (line 6) → line 3');
  await expect(page.locator('.stack-table .stack-owner')).toHaveText([
    'pow2 · call 1', 'pow2 · call 2', 'pow2 · call 3', 'pow2 · call 4',
  ]);

  // The stack view must not add memory rows (it reads without "accessing").
  const memRows = await page.locator('#memory tbody tr').count();
  expect(memRows).toBe(8);
});

test('the call list empties as calls return, and Step back brings them back', async ({ page }) => {
  await load(page, POW2, [{ key: 'X28', value: '8000' }]);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await step(page).click(); // ADDI
  await step(page).click(); // BL
  await expect(frames(page)).toHaveText(['pow2']);
  await page.getByRole('button', { name: 'Step back' }).click();
  await expect(frames(page)).toHaveCount(0);
  await expect(page.locator('.calls .frame-top')).toHaveText('top level');

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
  await expect(frames(page)).toHaveCount(0);
  await expect(page.locator('.calls .stack')).toContainText('The stack is empty.');
});

test('warns when a return goes to the wrong place', async ({ page }) => {
  await load(page, ['BL a', 'B end', 'a:', 'BL b', 'BR X30', 'b:', 'BR X30', 'end:'].join('\n'), []);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  for (let i = 0; i < 4; i++) await step(page).click();
  await expect(page.locator('.calls .call-warning')).toHaveText(
    'BR X30 went to line 5 (0xC), but a should return to line 2 (0x4). X30 may have been ' +
      'overwritten by a nested BL without being saved and restored.',
  );
  await expect(page.locator('.calls .stack-problem')).toHaveText(
    'X28 (SP) is 0. Set it under Registers to the top of a free memory area (for example 8000) before the first call.',
  );
});

test('clicking a call flashes its line in the editor', async ({ page }) => {
  await load(page, POW2, [{ key: 'X28', value: '8000' }]);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await step(page).click();
  await step(page).click();
  await page.locator('.calls .frame').first().click();
  await expect(page.locator('.cm-line.cm-flash')).toHaveText('BL pow2');
});

test('explains an invalid stack pointer in signed decimal', async ({ page }) => {
  // X28 was never set, so SUBI makes it -16 and the STUR fails.
  await load(page, POW2, []);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Error');
  await expect(page.locator('.calls .stack-meta')).toHaveText('SP (X28) = -16');
  await expect(page.locator('.calls .stack-problem')).toHaveText(
    "X28 (SP) is -16, which isn't a valid address. Set it under Registers to the top of a free memory area (for example 8000) before the first call.",
  );
});

test('flags popping more than was pushed', async ({ page }) => {
  await load(page, 'ADDI X28, X28, #16', [{ key: 'X28', value: '8000' }]);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await step(page).click();
  await expect(page.locator('.calls .stack-problem')).toHaveText(
    'SP is above the top of the stack (8000): more was popped than pushed.',
  );
});

test('runtime errors keep the zyBooks wording and add the signed address', async ({ page }) => {
  await load(page, POW2, []);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#console')).toHaveText(
    'Error: STUR X30, [X28, #8]. Invalid address: 18446744073709551608\n(That address is -8 as a signed value.)',
  );
});
