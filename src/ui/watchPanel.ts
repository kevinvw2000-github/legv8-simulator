// "Watch" panel: memory ranges the user pins, shown whether or not the program has touched them.
// The add form stays put across renders (so typing isn't interrupted while a program runs);
// only the list below it is rebuilt.

import { describeValue, formatValue, type ValueFormat } from '../core/bits';
import type { MachineState } from '../core/state';
import { MAX_WATCH_COUNT, parseWatch, watchRows, type WatchSpec } from '../core/watch';
import { binaryLines } from './storagePanel';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class WatchPanel {
  private watches: WatchSpec[];
  private readonly list: HTMLElement;
  private readonly error: HTMLElement;
  private last: { state: MachineState | null; format: ValueFormat } = { state: null, format: 'signed' };

  constructor(
    root: HTMLElement,
    initial: WatchSpec[],
    private readonly onChange: (watches: WatchSpec[]) => void,
  ) {
    this.watches = initial.map((w) => ({ ...w }));
    const form = el('form', 'watch-form');
    form.innerHTML = `
      <input name="label" type="text" placeholder="Name" aria-label="Watch name (optional)" spellcheck="false" maxlength="24">
      <input name="address" type="text" placeholder="Address" aria-label="Watch address" spellcheck="false" inputmode="numeric">
      <label class="watch-count">×<input name="count" type="number" min="1" max="${MAX_WATCH_COUNT}" value="1"
        aria-label="Number of doublewords" title="Number of doublewords (8 bytes each)"></label>
      <button type="submit">Watch</button>`;
    this.error = el('p', 'watch-error');
    this.error.setAttribute('role', 'alert');
    this.error.hidden = true;
    this.list = el('div', 'watch-list');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.add(form);
    });
    root.replaceChildren(form, this.error, this.list);
    this.render(null, 'signed');
  }

  private add(form: HTMLFormElement): void {
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
    const parsed = parseWatch(field('address').value, field('count').value);
    if ('error' in parsed) {
      this.error.textContent = parsed.error;
      this.error.hidden = false;
      field('address').focus();
      return;
    }
    this.error.hidden = true;
    this.watches.push({ label: field('label').value.trim(), address: parsed.address.toString(), count: parsed.count });
    field('label').value = '';
    field('address').value = '';
    field('count').value = '1';
    this.onChange(this.watches.map((w) => ({ ...w })));
    this.render(this.last.state, this.last.format);
  }

  private remove(i: number): void {
    this.watches.splice(i, 1);
    this.onChange(this.watches.map((w) => ({ ...w })));
    this.render(this.last.state, this.last.format);
  }

  /** Show the watches; with `state` (simulating), their current values. */
  render(state: MachineState | null, format: ValueFormat): void {
    this.last = { state, format };
    if (this.watches.length === 0) {
      this.list.replaceChildren(
        el('p', 'storage-empty', 'Pin addresses to see them before your program uses them, e.g. an array at 4000 × 5.'),
      );
      return;
    }
    this.list.replaceChildren(...this.watches.map((w, i) => this.group(w, i, state, format)));
    if (!state) this.list.append(el('p', 'storage-empty', 'Values appear while simulating.'));
  }

  private group(w: WatchSpec, i: number, state: MachineState | null, format: ValueFormat): HTMLElement {
    const address = BigInt(w.address);
    const name = w.label || w.address;
    const group = el('div', 'watch-group');
    const head = el('div', 'watch-head');
    // The name already shows the address when there's no label.
    const meta = [w.label ? w.address : '', w.count > 1 ? `${w.count} doublewords` : ''].filter(Boolean).join(' · ');
    head.append(el('span', 'watch-label', name), el('span', 'watch-range', meta));
    const remove = el('button', 'ghost icon', '×');
    remove.type = 'button';
    remove.title = 'Stop watching';
    remove.setAttribute('aria-label', `Stop watching ${name}`);
    remove.addEventListener('click', () => this.remove(i));
    head.append(remove);
    group.append(head);

    const table = el('table', 'storage-table watch-table');
    const body = el('tbody');
    const rows = state
      ? watchRows(state, address, w.count)
      : Array.from({ length: w.count }, (_, k) => ({ address: address + BigInt(k) * 8n, value: 0n, present: false, changed: false }));
    rows.forEach((r, k) => {
      const tr = el('tr');
      tr.dataset.address = r.address.toString();
      if (r.changed) tr.classList.add('changed');
      const th = el('th');
      th.scope = 'row';
      th.append(r.address.toString());
      if (w.count > 1) th.append(el('span', 'watch-index', `[${k}]`));
      const td = el('td', 'value');
      if (!state) {
        td.textContent = '—';
        td.classList.add('unset');
      } else if (!r.present) {
        td.textContent = '—';
        td.classList.add('unset');
        td.title = 'Not accessed yet (reads as 0)';
      } else {
        if (format === 'binary') td.append(...binaryLines(formatValue(r.value, format)));
        else td.textContent = formatValue(r.value, format);
        td.title = describeValue(r.value);
      }
      tr.append(th, td);
      body.append(tr);
    });
    table.append(body);
    group.append(table);
    return group;
  }
}
