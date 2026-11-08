import { expect, test, type Page } from '@playwright/test';

const PROGRAM = 'ADDI X1, XZR, #5\nADDI X2, X1, #1\nSTUR X2, [X3, #0]';

async function load(page: Page, expected: object | undefined) {
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('legv8-sim:v1', JSON.stringify(s)),
    {
      code: PROGRAM, registers: [{ key: 'X3', value: '4000' }], memory: [], speed: 'Instant', mode: 'zybooks',
      format: 'signed', breakpoints: [], watches: [], expected,
    },
  );
  await page.reload();
}

const exp = (page: Page, panel: string, key: string) => page.locator(`#${panel} tr[data-key="${key}"] td.col-expected`);
const step = (page: Page) => page.getByRole('button', { name: 'Step', exact: true });

test('new visitors start with no expected values', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(page.locator('#registers thead th.col-expected')).toBeHidden();
  await expect(page.locator('#expected summary')).toHaveText('Expected results ');
});

test('shows targets while stepping, then judges them when the program ends', async ({ page }) => {
  await load(page, { registers: 'X1 5, X2 7, X9 0, X10 3', memory: '4000 6, 4008 0', show: true, open: true });
  await page.getByRole('button', { name: 'Enter simulation' }).click();

  // Before the end: neutral targets, and rows for expected values not accessed yet.
  await expect(page.locator('#registers thead th.col-expected')).toBeVisible();
  await expect(exp(page, 'registers', 'X1')).toHaveText('5');
  await expect(exp(page, 'registers', 'X1')).toHaveAttribute('data-status', 'pending');
  await expect(page.locator('#registers tbody tr')).toHaveCount(5); // X3 (a starting value) plus the four expected
  await expect(page.locator('#registers tr[data-key="X10"]')).toHaveClass(/not-accessed/);

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
  await expect(exp(page, 'registers', 'X1')).toHaveText('✓ 5');
  await expect(exp(page, 'registers', 'X2')).toHaveText('✗ 7');
  await expect(exp(page, 'registers', 'X2')).toHaveAttribute('title', 'Expected 7, but it is 6');
  await expect(exp(page, 'registers', 'X9')).toHaveText('✓ 0'); // not accessed counts as 0
  await expect(exp(page, 'registers', 'X10')).toHaveText('✗ 3');
  await expect(exp(page, 'memory', '4000')).toHaveText('✓ 6');
  await expect(exp(page, 'memory', '4008')).toHaveText('✓ 0');
  await expect(page.locator('#console')).toHaveText(
    'Program finished after 3 steps.\nExpected values: 4 of 6 match. X2 is 6, expected 7; X10 is 0, expected 3.',
  );

  // Step back: no longer finished, so back to neutral.
  await page.getByRole('button', { name: 'Step back' }).click();
  await expect(exp(page, 'registers', 'X1')).toHaveAttribute('data-status', 'pending');
});

test('the Expected column can be hidden, and bad input is explained', async ({ page }) => {
  await load(page, { registers: 'X1 5', memory: '', show: true, open: true });
  await page.locator('#expected input[data-kind="memory"]').fill('4004 1');
  await expect(page.locator('#expected [data-error="memory"]')).toHaveText(
    "4004 isn't a multiple of 8 (doublewords start at 0, 8, 16, …).",
  );
  await expect(page.locator('#expected summary')).toHaveText('Expected results (1)');

  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(exp(page, 'registers', 'X1')).toBeVisible();
  await page.getByLabel('Show Expected column').uncheck();
  await expect(page.locator('#registers thead th.col-expected')).toBeHidden();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#console')).toHaveText('Program finished after 3 steps.');
});

test('old saved work without expected values shows no column', async ({ page }) => {
  await load(page, undefined);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(page.locator('#registers thead th.col-expected')).toBeHidden();
  await expect(page.locator('#expected summary')).toHaveText('Expected results ');
});
