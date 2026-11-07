import { expect, test, type Page } from '@playwright/test';

const KEY = 'legv8-sim:v1';
const base = (code: string) => ({
  code, registers: [], memory: [], speed: 'Instant', mode: 'zybooks', format: 'signed', breakpoints: [], watches: [],
});

async function seed(page: Page, state: object) {
  await page.goto('/');
  await page.evaluate(([k, s]) => localStorage.setItem(k as string, JSON.stringify(s)), [KEY, state]);
  await page.reload();
}

const savedCode = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).code as string, KEY);
const banner = (page: Page) => page.getByRole('region', { name: 'Shared program' });

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

/** Make a share link for a program, then switch the saved program to something else. */
async function makeLink(page: Page): Promise<string> {
  await seed(page, {
    ...base('ADDI X1, XZR, #5\nADDI X2, X1, #1'),
    registers: [{ key: 'X28', value: '8000' }],
    watches: [{ label: 'buf', address: '4000', count: 2 }],
    breakpoints: [2],
    mode: 'arm',
  });
  await page.getByRole('button', { name: 'Share link' }).click();
  await expect(page.locator('#console')).toContainText('Share link copied (');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/#s1=[\w-]+$/);
  await seed(page, base('ADD X9, X9, X9 // mine'));
  return url;
}

test('opens a shared program without touching your own until you choose', async ({ page }) => {
  const url = await makeLink(page);
  await page.goto(url);
  await expect(banner(page)).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveText('ADDI X1, XZR, #5ADDI X2, X1, #1');
  await expect(page.locator('#watch .watch-label')).toHaveText('buf');
  await expect(page.locator('#mode')).toHaveValue('arm');
  await expect(page.locator('.cm-bp-dot')).toHaveCount(1);

  // Editing the shared program doesn't overwrite the saved one.
  await page.locator('.cm-content').click();
  await page.keyboard.type(' // edited');
  expect(await savedCode(page)).toBe('ADD X9, X9, X9 // mine');

  // Reloading keeps showing the shared program (the link is still in the address bar).
  await page.reload();
  await expect(banner(page)).toBeVisible();

  await page.getByRole('button', { name: 'Back to my program' }).click();
  await expect(banner(page)).toBeHidden();
  await expect(page.locator('.cm-content')).toHaveText('ADD X9, X9, X9 // mine');
  await expect(page.locator('#mode')).toHaveValue('zybooks');
  await expect(page.locator('#watch .watch-group')).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('');
});

test('Keep it makes the shared program your saved program', async ({ page }) => {
  const url = await makeLink(page);
  await page.goto(url);
  await page.getByRole('button', { name: 'Keep it' }).click();
  await expect(banner(page)).toBeHidden();
  expect(await savedCode(page)).toBe('ADDI X1, XZR, #5\nADDI X2, X1, #1');
  await page.reload();
  await expect(banner(page)).toBeHidden();
  await expect(page.locator('#watch .watch-label')).toHaveText('buf');
});

test('a damaged link explains itself and leaves your program alone', async ({ page }) => {
  const url = await makeLink(page);
  await page.goto(url.slice(0, -12));
  await expect(page.locator('#console')).toHaveText(
    'This share link is damaged or incomplete. It may have been cut off when it was copied.',
  );
  await expect(banner(page)).toBeHidden();
  await expect(page.locator('.cm-content')).toHaveText('ADD X9, X9, X9 // mine');
});

test('opening a link while simulating leaves the simulation', async ({ page }) => {
  const url = await makeLink(page);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await page.evaluate((h) => (location.hash = h), new URL(url).hash);
  await expect(banner(page)).toBeVisible();
  await expect(page.locator('#status')).toHaveText('Editing');
});
