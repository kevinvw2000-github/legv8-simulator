// Register / memory panels.
// Edit mode: a list of initial values the user can add, change and remove.
// Simulation mode: the accessed entries (zyBooks style), with changed values highlighted.

import { MAX_ADDRESS } from '../core/state';
import { REGISTER_NAMES } from '../core/isa';

export interface Entry {
  key: string;
  value: string;
}

export interface ViewRow {
  key: string;
  value: string;
  changed: boolean;
}

export type PanelKind = 'registers' | 'memory';

const INT = /^-?\d+$/;
const MIN_S64 = -(1n << 63n);
const MAX_U64 = (1n << 64n) - 1n;

/** Validate a value cell. Returns an error message, or null when valid. */
export function validateValue(text: string): string | null {
  if (!INT.test(text.trim())) return 'Enter a whole number';
  const v = BigInt(text.trim());
  if (v < MIN_S64 || v > MAX_U64) return 'Out of 64-bit range';
  return null;
}

/** Validate a memory address cell. */
export function validateAddress(text: string): string | null {
  if (!/^\d+$/.test(text.trim())) return 'Enter a non-negative address';
  if (BigInt(text.trim()) > MAX_ADDRESS) return 'Address too large';
  return null;
}

export class StoragePanel {
  private entries: Entry[] = [];
  private readonly body: HTMLTableSectionElement;
  private readonly addButton: HTMLButtonElement;
  private readonly emptyNote: HTMLParagraphElement;
  private editing = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly kind: PanelKind,
    private readonly onChange: (entries: Entry[]) => void,
  ) {
    const label = kind === 'registers' ? 'Register' : 'Address';
    root.innerHTML = `
      <table class="storage-table">
        <thead><tr><th scope="col">${label}</th><th scope="col">Value</th><th class="col-remove"><span class="sr-only">Remove</span></th></tr></thead>
        <tbody></tbody>
      </table>
      <p class="storage-empty">Each has value 0</p>
      <button type="button" class="add-entry ghost">+ Add ${kind === 'registers' ? 'register' : 'address'}</button>`;
    this.body = root.querySelector('tbody') as HTMLTableSectionElement;
    this.addButton = root.querySelector('.add-entry') as HTMLButtonElement;
    this.emptyNote = root.querySelector('.storage-empty') as HTMLParagraphElement;
    this.addButton.addEventListener('click', () => this.addEntry());
  }

  getEntries(): Entry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /** True when every initial value is valid. */
  isValid(): boolean {
    return this.root.querySelectorAll('.invalid').length === 0;
  }

  setEntries(entries: Entry[]): void {
    this.entries = entries.map((e) => ({ ...e }));
    if (this.editing) this.renderEditing();
  }

  showEditing(): void {
    this.editing = true;
    this.root.classList.remove('simulating');
    this.renderEditing();
  }

  showSimulation(rows: ViewRow[]): void {
    this.editing = false;
    this.root.classList.add('simulating');
    this.addButton.hidden = true;
    this.emptyNote.hidden = rows.length > 0;
    this.body.replaceChildren(
      ...rows.map((r) => {
        const tr = document.createElement('tr');
        if (r.changed) tr.classList.add('changed');
        tr.dataset.key = r.key;
        tr.innerHTML = `<th scope="row"></th><td class="value"></td><td class="col-remove"></td>`;
        (tr.children[0] as HTMLElement).textContent = r.key;
        (tr.children[1] as HTMLElement).textContent = r.value;
        return tr;
      }),
    );
  }

  // ---------- editing ----------

  private nextKey(): string {
    if (this.kind === 'registers') {
      const used = new Set(this.entries.map((e) => e.key));
      return REGISTER_NAMES.find((n) => n !== 'XZR' && !used.has(n)) ?? 'X0';
    }
    const addrs = this.entries.map((e) => (INT.test(e.key) ? BigInt(e.key) : 0n));
    return addrs.length ? (addrs.reduce((a, b) => (a > b ? a : b)) + 8n).toString() : '4000';
  }

  private addEntry(): void {
    this.entries.push({ key: this.nextKey(), value: '0' });
    this.renderEditing();
    this.emit();
    const inputs = this.body.querySelectorAll<HTMLInputElement>('tr:last-child input');
    inputs[inputs.length - 1]?.focus();
    inputs[inputs.length - 1]?.select();
  }

  private emit(): void {
    this.onChange(this.getEntries());
  }

  private renderEditing(): void {
    this.addButton.hidden = false;
    this.emptyNote.hidden = this.entries.length > 0;
    const dupes = new Set(
      this.entries.map((e) => e.key).filter((k, i, all) => all.indexOf(k) !== i),
    );

    this.body.replaceChildren(
      ...this.entries.map((entry, i) => {
        const tr = document.createElement('tr');
        tr.dataset.key = entry.key;

        const keyCell = document.createElement('th');
        keyCell.scope = 'row';
        if (this.kind === 'registers') {
          const select = document.createElement('select');
          select.setAttribute('aria-label', 'Register');
          for (const name of REGISTER_NAMES.filter((n) => n !== 'XZR')) {
            select.add(new Option(name, name, false, name === entry.key));
          }
          select.addEventListener('change', () => {
            entry.key = select.value;
            this.renderEditing();
            this.emit();
          });
          if (dupes.has(entry.key)) markInvalid(select, 'Listed twice');
          keyCell.append(select);
        } else {
          keyCell.append(
            this.input(entry.key, 'Address', validateAddress, (v) => (entry.key = v), dupes.has(entry.key)),
          );
        }

        const valueCell = document.createElement('td');
        valueCell.append(this.input(entry.value, 'Value', validateValue, (v) => (entry.value = v)));

        const removeCell = document.createElement('td');
        removeCell.className = 'col-remove';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ghost icon';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${entry.key}`);
        remove.addEventListener('click', () => {
          this.entries.splice(i, 1);
          this.renderEditing();
          this.emit();
        });
        removeCell.append(remove);

        tr.append(keyCell, valueCell, removeCell);
        return tr;
      }),
    );
  }

  private input(
    value: string,
    label: string,
    validate: (v: string) => string | null,
    set: (v: string) => void,
    duplicate = false,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.spellcheck = false;
    input.value = value;
    input.setAttribute('aria-label', label);
    const check = () => {
      const err = validate(input.value) ?? (duplicate ? 'Listed twice' : null);
      if (err) markInvalid(input, err);
      else clearInvalid(input);
    };
    check();
    input.addEventListener('input', () => {
      duplicate = false;
      check();
      set(input.value.trim());
      this.emit();
    });
    input.addEventListener('change', () => this.renderEditing());
    return input;
  }
}

function markInvalid(el: HTMLElement, message: string): void {
  el.classList.add('invalid');
  el.setAttribute('aria-invalid', 'true');
  el.title = message;
}

function clearInvalid(el: HTMLElement): void {
  el.classList.remove('invalid');
  el.removeAttribute('aria-invalid');
  el.title = '';
}
