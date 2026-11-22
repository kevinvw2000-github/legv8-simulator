import { expect, test, type Page } from '@playwright/test';

const KEY = 'legv8-sim:v1';

const TEXTBOOK = [
  'MOV X1, #5', 'MOV X2, #3', 'MOV X3, #0', 'CMP X1, X2', 'B.GT Big', 'B End',
  'Big: MOV X3, #1', 'End: SUBI SP, SP, #16',
].join('\n');

async function load(page: Page, code: string, mode: string, registers: { key: string; value: string }[] = []) {
  await page.goto('/');
  await page.evaluate(
    ([k, s]) => localStorage.setItem(k as string, JSON.stringify(s)),
    [KEY, { code, registers, memory: [], speed: 'Instant', mode, format: 'signed', breakpoints: [], watches: [], expected: {} }],
  );
  await page.reload();
}

const badge = (page: Page) => page.locator('#mode-badge');
const convert = (page: Page) => page.getByRole('button', { name: 'Convert to zyBooks' });
const reg = (page: Page, name: string) => page.locator(`#registers tbody tr[data-key="${name}"] td.value`);
const editorText = (page: Page) => page.locator('.cm-content').innerText();

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('the Compatibility dropdown has three choices, and Full LEGv8 is marked', async ({ page }) => {
  await load(page, 'ADD X1, X2, X3', 'zybooks');
  await expect(page.locator('label.mode')).toContainText('Compatibility');
  await expect(page.locator('#mode option')).toHaveText(['zyBooks-compatible', 'ARM-accurate', 'Full LEGv8']);
  await expect(badge(page)).toBeHidden();
  await expect(convert(page)).toBeHidden();

  await page.locator('#mode').selectOption('full');
  await expect(badge(page)).toBeVisible();
  await expect(badge(page)).toHaveText('Not zyBooks-compatible');
  await expect(convert(page)).toBeVisible();

  await page.reload(); // remembered
  await expect(page.locator('#mode')).toHaveValue('full');
  await expect(badge(page)).toBeVisible();

  await page.locator('#mode').selectOption('arm');
  await expect(badge(page)).toBeHidden();
  await expect(convert(page)).toBeHidden();
});

test('Full LEGv8 runs textbook-style code: CMP, MOV and SP', async ({ page }) => {
  await load(page, TEXTBOOK, 'full', [{ key: 'X28', value: '8000' }]);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('#status')).toHaveText('Finished');
  await expect(reg(page, 'X3')).toHaveText('1');
  await expect(reg(page, 'X28')).toHaveText('7984');
  await expect(convert(page)).toBeDisabled();
  await expect(page.locator('#mode')).toBeDisabled();
});

test('the other modes reject it, with a hint about what to write', async ({ page }) => {
  await load(page, TEXTBOOK, 'zybooks');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(page.locator('#status')).toHaveText('Editing');
  await expect(page.locator('#console')).toHaveText(
    "Line 1: Unrecognized op code: MOV\nMOV isn't available here (zyBooks doesn't have it). " +
      'Write ADD Xd, Xn, XZR (or ADDI Xd, XZR, #imm) instead. (Or switch Compatibility to Full LEGv8.)',
  );

  await load(page, 'ADD SP, SP, XZR', 'arm');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(page.locator('#console')).toHaveText(
    "Line 1: Instruction has an error.\nSP isn't a register name here (zyBooks doesn't have it). " +
      'Write X28. (Or switch Compatibility to Full LEGv8.)',
  );
});

test('Convert to zyBooks rewrites the code, switches mode, and can be undone', async ({ page }) => {
  await load(page, 'CMP X1, X2 // compare\nMOV LR, SP\nADDI SP, SP, #-16', 'full');
  await convert(page).click();
  await expect(page.locator('#console')).toHaveText(
    'Converted 3 lines and switched to zyBooks-compatible. Click in the code and press Ctrl+Z to undo the conversion.',
  );
  expect(await editorText(page)).toBe('SUBS XZR, X1, X2 // compare\nADD X30, X28, XZR\nADDI X28, X28, #-16');
  await expect(page.locator('#mode')).toHaveValue('zybooks');
  await expect(badge(page)).toBeHidden();
  await expect(convert(page)).toBeHidden();
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), KEY);
  expect(saved.mode).toBe('zybooks');
  expect(saved.code.startsWith('SUBS XZR, X1, X2')).toBe(true);

  // It runs in zyBooks mode now.
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await page.getByRole('button', { name: 'Exit simulation' }).click();

  // The editor's own undo restores the original text.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await editorText(page)).toBe('CMP X1, X2 // compare\nMOV LR, SP\nADDI SP, SP, #-16');
});

test('Convert stays in Full LEGv8 and lists what it could not convert', async ({ page }) => {
  await load(page, 'MOV X1, #5\nUDIV X2, X1, X1\nADDI X3, X1, #2000', 'full');
  await convert(page).click();
  await expect(page.locator('#console')).toHaveText(
    "Converted 1 line. zyBooks still won't accept:\n" +
      "Line 2: UDIV isn't in zyBooks. Use SDIV (same result for values from 0 up to 2^32 − 1).\n" +
      "Line 3: 2000 is outside zyBooks' range (-1024 to 1023).",
  );
  expect(await editorText(page)).toBe('ADDI X1, XZR, #5\nUDIV X2, X1, X1\nADDI X3, X1, #2000');
  await expect(page.locator('#mode')).toHaveValue('full');
  await expect(badge(page)).toBeVisible();
});

test('Export warns about code zyBooks would reject, only in Full LEGv8 mode', async ({ page }) => {
  await load(page, 'CMP X1, X2\nADD X1, X2, X3', 'full');
  await page.getByText('Import / Export').click();
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.locator('#console')).toHaveText(
    'Exported. Paste this into zyBooks (More options → Import) or keep it to import later.\n' +
      "Heads up: zyBooks won't accept line 1 (CMP). Use Convert to zyBooks first.",
  );
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.locator('#console')).toContainText("Copied to clipboard.\nHeads up: zyBooks won't accept line 1 (CMP).");

  await page.locator('#mode').selectOption('zybooks');
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.locator('#console')).toHaveText(
    'Exported. Paste this into zyBooks (More options → Import) or keep it to import later.',
  );
});

test('a share link carries Full LEGv8 mode', async ({ page }) => {
  await load(page, TEXTBOOK, 'full');
  await page.getByRole('button', { name: 'Share link' }).click();
  await expect(page.locator('#console')).toContainText('Share link copied (');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await load(page, 'ADD X1, X1, X1', 'zybooks');
  await page.goto(url);
  await expect(page.locator('#mode')).toHaveValue('full');
  await expect(badge(page)).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('CMP X1, X2');
  await page.getByRole('button', { name: 'Back to my program' }).click();
  await expect(page.locator('#mode')).toHaveValue('zybooks');
  await expect(badge(page)).toBeHidden();
});

test('Help follows Full LEGv8 mode', async ({ page }) => {
  await load(page, 'ADD X1, X2, X3', 'full');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Help' });
  await expect(dialog.getByLabel('Compatibility mode')).toHaveValue('full');
  await expect(page.locator('.help-item')).toHaveCount(55);
  await expect(page.locator('.help-mode-info')).toContainText('Real-ARM behavior');
  const cmp = page.locator('.help-item[data-op="CMP"]');
  await expect(cmp.locator('.help-chip-full')).toHaveText('Full LEGv8 only');
  await expect(cmp.locator('.help-syntax')).toHaveText('CMP Xn, Xm');
  await expect(cmp.locator('.help-range')).toHaveText('= SUBS XZR, Xn, Xm');
  await expect(page.locator('.help-item[data-op="ADDI"] .help-range')).toHaveText('imm: -1024 to 4095');
  // A quirk note shows the real-ARM text, and the other mode's text on request.
  await expect(page.locator('.help-item[data-op="SDIV"] .help-note')).toContainText('Real ARM');
  await dialog.getByLabel('Show how the other mode differs').check();
  await expect(page.locator('.help-item[data-op="SDIV"] .help-note-other')).toContainText('zyBooks-compatible: zyBooks quirk');

  await page.getByText('Not supported in any mode').click();
  await expect(page.locator('.help-table')).toContainText('LDXR, STXR');
  await expect(page.locator('.help-table')).not.toContainText('CMPI');

  // Switching to zyBooks from inside Help takes the extras away.
  await dialog.getByLabel('Compatibility mode').selectOption('zybooks');
  await expect(page.locator('.help-item')).toHaveCount(47);
  await expect(page.locator('#mode')).toHaveValue('zybooks');
  await page.getByText('Not supported (and what to write instead)').click();
  await expect(page.locator('.help-table')).toContainText('CMPI Xn, #imm');
  await expect(page.locator('.help-table tbody tr', { hasText: 'LDXR' }).locator('.help-full-col')).toHaveText('—');
  await expect(page.locator('.help-table tbody tr', { hasText: 'CMPI' }).locator('.help-full-col')).toHaveText('✓');
});
