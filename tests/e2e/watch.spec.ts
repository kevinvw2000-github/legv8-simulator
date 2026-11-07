import { expect, test, type Page } from '@playwright/test';

const SQUARES = [
  'ADDI X1, XZR, #0', 'ADDI X2, XZR, #1000', 'Loop:', 'SUBIS XZR, X1, #3', 'B.GE Done',
  'MUL X3, X1, X1', 'STUR X3, [X2, #0]', 'ADDI X2, X2, #8', 'ADDI X1, X1, #1', 'B Loop', 'Done:',
].join('\n');

async function load(page: Page, code: string, watches: unknown[] = []) {
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('legv8-sim:v1', JSON.stringify(s)),
    { code, registers: [], memory: [], speed: 'Instant', mode: 'zybooks', format: 'signed', breakpoints: [], watches },
  );
  await page.reload();
}

const values = (page: Page) => page.locator('#watch .watch-table td.value');
const step = (page: Page) => page.getByRole('button', { name: 'Step', exact: true });

test('new visitors see the demo array watched', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#watch .watch-label')).toHaveText('array');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(values(page)).toHaveText(['5', '7', '9']);
});

test('adds a watch and shows an array filling in, without adding Memory rows', async ({ page }) => {
  await load(page, SQUARES);
  await page.getByLabel('Watch name (optional)').fill('squares');
  await page.getByLabel('Watch address').fill('1000');
  await page.getByLabel('Number of doublewords').fill('3');
  await page.getByRole('button', { name: 'Watch', exact: true }).click();
  await expect(page.locator('#watch .watch-range')).toHaveText('1000 · 3 doublewords');
  await expect(page.locator('#watch .watch-index')).toHaveText(['[0]', '[1]', '[2]']);

  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(values(page)).toHaveText(['—', '—', '—']);
  await expect(page.locator('#memory tbody tr')).toHaveCount(0);

  for (let i = 0; i < 6; i++) await step(page).click(); // through the first STUR
  await expect(values(page)).toHaveText(['0', '—', '—']);
  await expect(page.locator('#watch tr.changed')).toHaveAttribute('data-address', '1000');

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
  await expect(values(page)).toHaveText(['0', '1', '4']);
  await expect(page.locator('#memory tbody tr')).toHaveCount(3);

  // Watches are saved.
  await page.reload();
  await expect(page.locator('#watch .watch-label')).toHaveText('squares');
});

test('explains a bad address and can remove a watch', async ({ page }) => {
  await load(page, SQUARES, [{ label: '', address: '1000', count: 1 }]);
  await page.getByLabel('Watch address').fill('1004');
  await page.getByLabel('Watch address').press('Enter');
  await expect(page.locator('#watch .watch-error')).toHaveText(
    'Use a multiple of 8 (doublewords start at 1000, 1008, …).',
  );
  await page.getByRole('button', { name: 'Stop watching 1000' }).click();
  await expect(page.locator('#watch .watch-group')).toHaveCount(0);
});

test('can add a watch while paused, and Ctrl+Z in its fields does not step back', async ({ page }) => {
  await load(page, SQUARES);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await step(page).click();
  await page.getByLabel('Watch address').fill('1000');
  await page.getByLabel('Watch address').press('ControlOrMeta+z');
  await expect(page.locator('#steps')).toHaveText('1');
  await page.getByLabel('Watch address').fill('1000');
  await page.getByLabel('Watch address').press('Enter');
  await expect(values(page)).toHaveText(['—']);
});
