import { expect, test, type Page } from '@playwright/test';

async function load(page: Page, code: string, registers: { key: string; value: string }[] = [], format = 'signed') {
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('legv8-sim:v1', JSON.stringify(s)),
    { code, registers, memory: [], speed: 'Instant', mode: 'zybooks', format, breakpoints: [], watches: [], expected: {} },
  );
  await page.reload();
}

/** Move the pointer onto the first occurrence of `token` in the editor line containing `lineText`. */
async function pointOn(page: Page, lineText: string, token: string) {
  const p = await page.evaluate(
    ([lineText, token]: [string, string]) => {
      const line = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent!.includes(lineText))!;
      const start = line.textContent!.indexOf(token);
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const len = n.textContent!.length;
        if (start < seen + len) {
          const r = document.createRange();
          r.setStart(n, start - seen);
          r.setEnd(n, start - seen + 1);
          const b = r.getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }
        seen += len;
      }
      throw new Error('token not found');
    },
    [lineText, token] as [string, string],
  );
  // Leave the editor first so any tooltip from the previous hover closes.
  await page.mouse.move(2, 2);
  await expect(page.locator('.hv:visible')).toHaveCount(0);
  await page.mouse.move(p.x - 6, p.y);
  await page.mouse.move(p.x, p.y);
}

const tip = (page: Page) => page.locator('.hv');
const step = (page: Page) => page.getByRole('button', { name: 'Step', exact: true });

test('no hover while editing', async ({ page }) => {
  await load(page, 'ADDI X1, XZR, #5');
  await pointOn(page, 'ADDI X1', 'X1');
  await page.waitForTimeout(600);
  await expect(tip(page)).toHaveCount(0);
});

test('shows a register, stays live while stepping, and never lists the register in the panel', async ({ page }) => {
  await load(page, 'ADDI X1, XZR, #5\nADDI X1, X1, #1\nADD X9, X1, X1');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await pointOn(page, 'ADD X9', 'X9');
  await expect(tip(page)).toContainText('X9');
  await expect(tip(page)).toContainText('Not used yet (reads as 0) · before line 1 runs');
  await expect(page.locator('#registers tr[data-key="X9"]')).toHaveCount(0);

  await pointOn(page, 'ADDI X1, X1', 'X1');
  await expect(tip(page).locator('.hv-on').first()).toHaveText('0');
  await page.keyboard.press('F10');
  await expect(tip(page).locator('.hv-on').first()).toHaveText('5');
  await expect(tip(page)).toContainText('Value before line 2 runs');
  await expect(tip(page)).toContainText('0x0000_0000_0000_0005');
  await page.keyboard.press('F10');
  await expect(tip(page).locator('.hv-on').first()).toHaveText('6');
});

test('shows roles for SP, link register and XZR, and follows the value format', async ({ page }) => {
  await load(page, 'BL f\nB end\nf:\nSUBI X28, X28, #16\nBR X30\nend:', [{ key: 'X28', value: '8000' }], 'hex');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await pointOn(page, 'SUBI X28', 'X28');
  await expect(tip(page)).toContainText('stack pointer (SP)');
  await expect(tip(page).locator('.hv-on').first()).toHaveText('0x0000_0000_0000_1F40');
  await step(page).click(); // BL
  await pointOn(page, 'BR X30', 'X30');
  await expect(tip(page)).toContainText('link register — returns to line 2 (0x4)');
});

test('shows the address and contents behind a load or store operand', async ({ page }) => {
  await load(page, 'ADDI X1, XZR, #7\nSTUR X1, [X28, #8]\nLDUR X2, [X28, #8]\nLDUR X3, [X28, #16]', [{ key: 'X28', value: '800' }]);
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await step(page).click();
  await step(page).click(); // the store has run
  const memoryRows = await page.locator('#memory tbody tr').count();

  await pointOn(page, 'LDUR X2', '#8');
  await expect(tip(page)).toContainText('Address 808');
  await expect(tip(page)).toContainText('= X28 (800) + 8');
  await expect(tip(page)).toContainText('The doubleword LDUR loads:');
  await expect(tip(page).locator('.hv-on').first()).toHaveText('7');

  await pointOn(page, 'LDUR X3', '#16');
  await expect(tip(page)).toContainText('Address 816');
  await expect(tip(page)).toContainText('Not accessed yet (reads as 0)');
  expect(await page.locator('#memory tbody tr').count()).toBe(memoryRows); // looking added nothing
});

test('warns about an invalid address and ignores comments', async ({ page }) => {
  await load(page, 'LDUR X1, [X7, #-8] // X9 is not used');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await pointOn(page, 'LDUR X1', '#-8');
  await expect(tip(page)).toContainText('Address 18446744073709551608');
  await expect(tip(page)).toContainText('-8 as signed');
  await expect(tip(page).locator('.hv-error')).toHaveText('Not a valid address, so LDUR will stop the program.');

  await pointOn(page, 'LDUR X1', 'X9');
  await page.waitForTimeout(600);
  await expect(tip(page)).toHaveCount(0);
});

test('is turned off when the simulation ends', async ({ page }) => {
  await load(page, 'ADDI X1, XZR, #5');
  await page.getByRole('button', { name: 'Enter simulation' }).click();
  await pointOn(page, 'ADDI X1', 'X1');
  await expect(tip(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter'); // exit simulation
  await expect(tip(page)).toBeHidden();
});
