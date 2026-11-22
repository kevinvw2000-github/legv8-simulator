// Help dialog: the instructions available in the selected compatibility mode, syntax rules,
// registers, what isn't supported, and keyboard shortcuts. Content comes from core/help.ts.

import {
  HELP_GROUPS,
  MODE_INFO,
  SHORTCUTS,
  UNSUPPORTED,
  behaviorOf,
  instructionsFor,
  registerNotesFor,
  rulesFor,
  type HelpItem,
} from '../core/help';
import type { Mode } from '../core/state';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

export interface HelpState {
  mode: Mode;
  /** While simulating, the mode can't change and examples can't be inserted. */
  simulating: boolean;
}

export class HelpPanel {
  private state: HelpState = { mode: 'zybooks', simulating: false };
  private query = '';
  private showOther = false;
  private readonly body: HTMLElement;
  private readonly search: HTMLInputElement;

  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly onModeChange: (mode: Mode) => void,
    /** Add an example line to the editor. */
    private readonly onInsert: (line: string) => void,
  ) {
    dialog.innerHTML = `
      <div class="help-head">
        <h2 id="help-title">Help</h2>
        <button type="button" class="ghost icon" data-close aria-label="Close help">×</button>
      </div>
      <div class="help-controls">
        <label class="help-mode">Compatibility
          <select aria-label="Compatibility mode">
            <option value="zybooks">${MODE_INFO.zybooks.name}</option>
            <option value="arm">${MODE_INFO.arm.name}</option>
            <option value="full">${MODE_INFO.full.name}</option>
          </select>
        </label>
        <label class="help-other"><input type="checkbox"> Show how the other mode differs</label>
        <input type="search" class="help-search" placeholder="Search instructions" aria-label="Search instructions" spellcheck="false" autocomplete="off">
      </div>
      <div class="help-body"></div>`;
    dialog.setAttribute('aria-labelledby', 'help-title');
    this.body = dialog.querySelector('.help-body') as HTMLElement;
    this.search = dialog.querySelector('.help-search') as HTMLInputElement;
    const select = dialog.querySelector('select') as HTMLSelectElement;

    dialog.querySelector('[data-close]')!.addEventListener('click', () => dialog.close());
    // A click on the backdrop (outside the dialog's box) closes it.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    select.addEventListener('change', () => this.onModeChange(select.value as Mode));
    (dialog.querySelector('.help-other input') as HTMLInputElement).addEventListener('change', (e) => {
      this.showOther = (e.target as HTMLInputElement).checked;
      this.render();
    });
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.applyFilter();
    });
  }

  isOpen(): boolean {
    return this.dialog.open;
  }

  open(state: HelpState): void {
    this.update(state);
    if (!this.dialog.open) this.dialog.showModal();
    this.search.focus();
  }

  /** Re-render for a new mode or simulation state (no-op until first opened). */
  update(state: HelpState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    const { mode, simulating } = this.state;
    // Full LEGv8 behaves like ARM-accurate, so its notes are the "real ARM" ones.
    const behave = behaviorOf(mode);
    const other: Mode = behave === 'zybooks' ? 'arm' : 'zybooks';
    const select = this.dialog.querySelector('select') as HTMLSelectElement;
    select.value = mode;
    select.disabled = simulating;
    select.title = simulating ? 'Exit the simulation to change the mode' : '';

    const parts: HTMLElement[] = [];
    const info = el('p', 'help-mode-info', MODE_INFO[mode].text);
    if (simulating) info.append(' (The mode can’t be changed while simulating.)');
    parts.push(info);

    const items = instructionsFor(mode);
    for (const group of HELP_GROUPS) {
      const rows = items.filter((i) => i.group === group);
      if (rows.length === 0) continue;
      const section = el('section', 'help-group');
      section.dataset.group = group;
      section.append(el('h3', undefined, group));
      const list = el('ul', 'help-list');
      for (const item of rows) list.append(this.item(item, behave, other, simulating));
      section.append(list);
      parts.push(section);
    }
    parts.push(el('p', 'storage-empty help-none', 'No instruction matches your search.'));
    (parts[parts.length - 1] as HTMLElement).hidden = true;

    parts.push(
      this.details('Syntax rules', rulesFor(mode)),
      this.details('Registers', registerNotesFor(mode)),
      this.unsupported(mode),
      this.shortcuts(),
    );
    this.body.replaceChildren(...parts);
    this.applyFilter();
  }

  private item(item: HelpItem, mode: Mode, other: Mode, simulating: boolean): HTMLElement {
    const li = el('li', 'help-item');
    li.dataset.op = item.op;
    li.dataset.text = `${item.op} ${item.syntax} ${item.meaning} ${item.group}`.toLowerCase();

    const head = el('div', 'help-item-head');
    const syntax = el('code', 'help-syntax');
    syntax.append(el('strong', undefined, item.op), item.syntax.slice(item.op.length));
    head.append(syntax);
    if (item.modes) head.append(el('span', 'help-chip help-chip-full', 'Full LEGv8 only'));
    if (item.setsFlags) head.append(el('span', 'help-chip', 'sets flags'));
    if (item.readsFlags) head.append(el('span', 'help-chip', 'reads flags'));
    if (!simulating) {
      const insert = el('button', 'ghost help-insert', 'Insert');
      insert.type = 'button';
      insert.title = `Add “${item.example}” to your code`;
      insert.addEventListener('click', () => {
        this.dialog.close();
        this.onInsert(item.example);
      });
      head.append(insert);
    }
    li.append(head, el('p', 'help-meaning', item.meaning));
    if (item.alias) li.append(el('p', 'help-range', `= ${item.alias}`));
    if (item.range) li.append(el('p', 'help-range', item.range));

    const note = item.modeNote?.[mode];
    if (note) li.append(el('p', 'help-note', note));
    const otherNote = item.modeNote?.[other];
    if (this.showOther && otherNote) {
      const p = el('p', 'help-note help-note-other');
      p.append(el('strong', undefined, `${MODE_INFO[other].name}: `), otherNote);
      li.append(p);
    }
    return li;
  }

  private details(title: string, lines: readonly string[]): HTMLElement {
    const d = el('details', 'help-details');
    d.append(el('summary', undefined, title));
    const ul = el('ul');
    for (const line of lines) ul.append(el('li', undefined, line));
    d.append(ul);
    return d;
  }

  private unsupported(mode: Mode): HTMLElement {
    const full = mode === 'full';
    const d = el('details', 'help-details');
    d.append(el('summary', undefined, full ? 'Not supported in any mode' : 'Not supported (and what to write instead)'));
    d.append(
      el(
        'p',
        'help-lead',
        full
          ? 'These appear in the LEGv8 textbook but aren’t available here, even in Full LEGv8.'
          : 'These appear in the LEGv8 textbook, but zyBooks doesn’t accept them, so neither does this mode. Full LEGv8 accepts the ones marked ✓.',
      ),
    );
    const table = el('table', 'help-table');
    table.innerHTML = `<thead><tr><th scope="col">Instead of</th><th scope="col">Write</th>${
      full ? '' : '<th scope="col">Full LEGv8</th>'
    }</tr></thead>`;
    const tbody = el('tbody');
    for (const u of UNSUPPORTED.filter((x) => !full || !x.inFull)) {
      const tr = el('tr');
      tr.append(el('td', undefined, u.what), el('td', undefined, u.instead));
      for (const td of tr.children) td.classList.add('mono');
      if (!full) tr.append(el('td', 'help-full-col', u.inFull ? '✓' : '—'));
      tbody.append(tr);
    }
    table.append(tbody);
    d.append(table);
    return d;
  }

  private shortcuts(): HTMLElement {
    const d = el('details', 'help-details');
    d.append(el('summary', undefined, 'Keyboard shortcuts'));
    const ul = el('ul');
    for (const [keys, what] of SHORTCUTS) {
      const li = el('li');
      li.append(el('kbd', undefined, keys), ` ${what}`);
      ul.append(li);
    }
    d.append(ul);
    return d;
  }

  /** Hide instructions that don't match the search, and groups left with none. */
  private applyFilter(): void {
    let any = false;
    for (const section of this.body.querySelectorAll<HTMLElement>('.help-group')) {
      let shown = 0;
      for (const li of section.querySelectorAll<HTMLElement>('.help-item')) {
        const match = this.query === '' || (li.dataset.text ?? '').includes(this.query);
        li.hidden = !match;
        if (match) shown++;
      }
      section.hidden = shown === 0;
      any ||= shown > 0;
    }
    const none = this.body.querySelector<HTMLElement>('.help-none');
    if (none) none.hidden = any;
  }
}
