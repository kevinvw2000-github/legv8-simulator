// "Expected results" panel: two pair-format fields (registers, memory) and a toggle for the
// Expected column in the Registers and Memory panels. Fields stay editable while simulating.

import { parseExpected, type ExpectedEntry, type ExpectedKind } from '../core/expected';

export interface ExpectedSettings {
  registers: string;
  memory: string;
  /** Show the Expected column and the summary. */
  show: boolean;
  /** Whether the panel is expanded. */
  open: boolean;
}

export const NO_EXPECTED: ExpectedSettings = { registers: '', memory: '', show: true, open: false };

export class ExpectedPanel {
  private settings: ExpectedSettings;
  private readonly details: HTMLDetailsElement;
  private readonly count: HTMLElement;
  private readonly fields: Record<ExpectedKind, { input: HTMLInputElement; error: HTMLElement }>;
  private readonly show: HTMLInputElement;

  constructor(
    root: HTMLDetailsElement,
    initial: ExpectedSettings,
    private readonly onChange: (s: ExpectedSettings) => void,
  ) {
    this.settings = { ...initial };
    this.details = root;
    root.innerHTML = `
      <summary>Expected results <span class="expected-count"></span></summary>
      <p class="io-note">Values you expect when the program ends, in the same format as zyBooks' Import.
        Only listed values are checked; values the program never accessed count as 0.</p>
      <label class="expected-field">Registers
        <input type="text" data-kind="registers" placeholder="X0 15, X9 -1" spellcheck="false" autocomplete="off">
      </label>
      <p class="watch-error" data-error="registers" role="alert" hidden></p>
      <label class="expected-field">Memory
        <input type="text" data-kind="memory" placeholder="5000 1, 5008 350" spellcheck="false" autocomplete="off">
      </label>
      <p class="watch-error" data-error="memory" role="alert" hidden></p>
      <label class="expected-show"><input type="checkbox"> Show Expected column</label>`;
    this.count = root.querySelector('.expected-count') as HTMLElement;
    const field = (kind: ExpectedKind) => ({
      input: root.querySelector(`input[data-kind="${kind}"]`) as HTMLInputElement,
      error: root.querySelector(`[data-error="${kind}"]`) as HTMLElement,
    });
    this.fields = { registers: field('registers'), memory: field('memory') };
    this.show = root.querySelector('.expected-show input') as HTMLInputElement;

    for (const kind of ['registers', 'memory'] as const) {
      const { input } = this.fields[kind];
      input.addEventListener('input', () => {
        this.settings[kind] = input.value;
        this.update();
      });
    }
    this.show.addEventListener('change', () => {
      this.settings.show = this.show.checked;
      this.update();
    });
    root.addEventListener('toggle', () => {
      if (this.settings.open === root.open) return;
      this.settings.open = root.open;
      this.onChange({ ...this.settings });
    });
    this.setSettings(initial);
  }

  /** Replace everything (e.g. when a share link is opened). Doesn't call onChange. */
  setSettings(s: ExpectedSettings): void {
    this.settings = { ...s };
    this.fields.registers.input.value = s.registers;
    this.fields.memory.input.value = s.memory;
    this.show.checked = s.show;
    this.details.open = s.open;
    this.refresh();
  }

  /** Valid expected entries (an invalid field contributes none). */
  entries(): Record<ExpectedKind, ExpectedEntry[]> {
    const get = (kind: ExpectedKind) => {
      const p = parseExpected(kind, this.settings[kind]);
      return 'entries' in p ? p.entries : [];
    };
    return { registers: get('registers'), memory: get('memory') };
  }

  /** True when the Expected column should be shown. */
  active(): boolean {
    const e = this.entries();
    return this.settings.show && e.registers.length + e.memory.length > 0;
  }

  private update(): void {
    this.refresh();
    this.onChange({ ...this.settings });
  }

  private refresh(): void {
    let total = 0;
    for (const kind of ['registers', 'memory'] as const) {
      const { input, error } = this.fields[kind];
      const p = parseExpected(kind, this.settings[kind]);
      if ('error' in p) {
        input.classList.add('invalid');
        input.setAttribute('aria-invalid', 'true');
        error.textContent = p.error;
        error.hidden = false;
      } else {
        input.classList.remove('invalid');
        input.removeAttribute('aria-invalid');
        error.hidden = true;
        total += p.entries.length;
      }
    }
    this.count.textContent = total > 0 ? `(${total})` : '';
  }
}
