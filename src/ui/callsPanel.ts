// "Call stack" panel: active BL calls (innermost first), a warning when a return goes astray,
// and the stack memory from SP (X28) up to the top of the stack area.

import { describeValue, formatValue, s64, type ValueFormat } from '../core/bits';
import { MAX_ADDRESS } from '../core/state';
import type { FrameView, StackView } from '../core/calls';

export interface CallsData {
  frames: FrameView[];
  warning: string | null;
  stack: StackView;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class CallsPanel {
  constructor(
    private readonly root: HTMLElement,
    /** Called with a 1-based source line when a call is clicked. */
    private readonly onShowLine: (line: number) => void,
  ) {}

  render(data: CallsData | null, format: ValueFormat): void {
    if (!data) {
      this.root.replaceChildren(el('p', 'storage-empty', 'Calls made with BL appear here while simulating.'));
      return;
    }
    const parts: HTMLElement[] = [];

    if (data.warning) {
      const w = el('p', 'call-warning', data.warning);
      w.setAttribute('role', 'alert');
      parts.push(w);
    }

    const list = el('ol', 'frames');
    list.setAttribute('aria-label', 'Active calls, innermost first');
    for (const f of data.frames) {
      const li = el('li');
      const button = el('button', 'frame');
      button.type = 'button';
      button.title = `Show the call on line ${f.callLine}`;
      button.append(
        el('span', 'frame-label', f.label),
        el('span', 'frame-depth', `call ${f.depth}`),
        el('span', 'frame-meta', `called from line ${f.callLine} · returns to ${f.returnsTo}`),
      );
      button.addEventListener('click', () => this.onShowLine(f.callLine));
      li.append(button);
      list.append(li);
    }
    const top = el('li', 'frame-top', 'top level');
    list.append(top);
    parts.push(list);

    parts.push(this.stack(data.stack, format));
    this.root.replaceChildren(...parts);
  }

  private stack(v: StackView, format: ValueFormat): HTMLElement {
    const wrap = el('div', 'stack');
    const head = el('h3', undefined, 'Stack');
    // SP is an address, so it's shown in signed decimal like the memory panel's addresses;
    // signed makes an underflow (e.g. -16) obvious.
    const sp = s64(v.sp).toString();
    const meta = el('span', 'stack-meta', `SP (X28) = ${sp}${v.top !== null ? ` · top ${v.top}` : ''}`);
    head.append(meta);
    wrap.append(head);

    const advice = 'Set it under Registers to the top of a free memory area (for example 8000) before the first call.';
    const problem =
      v.sp > MAX_ADDRESS
        ? `X28 (SP) is ${sp}, which isn't a valid address. ${v.top === null ? advice : ''}`
        : v.top === null
          ? `X28 (SP) is ${sp}. ${advice}`
          : v.sp > v.top
            ? `SP is above the top of the stack (${v.top}): more was popped than pushed.`
            : null;
    if (problem) {
      wrap.append(el('p', 'stack-problem', problem.trim()));
      return wrap;
    }
    if (v.rows.length === 0) {
      wrap.append(el('p', 'storage-empty', 'The stack is empty.'));
      return wrap;
    }

    const table = el('table', 'storage-table stack-table');
    table.innerHTML =
      '<thead><tr><th scope="col">Address</th><th scope="col">Value</th><th scope="col">Saved</th></tr></thead>';
    const body = el('tbody');
    let lastOwner: string | undefined;
    // Highest address first, like a stack drawn growing downward, so SP is at the bottom.
    for (const r of [...v.rows].reverse()) {
      const owner = r.owner ? `${r.owner.label} · call ${r.owner.depth}` : 'top level';
      if (owner !== lastOwner) {
        const tr = el('tr', 'stack-owner');
        const th = el('th', undefined, owner);
        th.colSpan = 3;
        tr.append(th);
        body.append(tr);
        lastOwner = owner;
      }
      const tr = el('tr');
      tr.dataset.address = r.address.toString();
      if (r.offset === 0n) tr.classList.add('stack-sp');
      const addr = el('th');
      addr.scope = 'row';
      addr.append(r.address.toString(), el('span', 'stack-offset', r.offset === 0n ? 'SP' : `SP+${r.offset}`));
      const value = el('td', 'value');
      if (r.present) {
        value.textContent = formatValue(r.value, format === 'binary' ? 'hex' : format);
        value.title = describeValue(r.value);
      } else {
        value.textContent = '—';
        value.classList.add('unset');
        value.title = 'Not written yet';
      }
      tr.append(addr, value, el('td', 'stack-note', r.note ?? ''));
      body.append(tr);
    }
    table.append(body);
    if (v.hidden > 0) {
      // Hidden rows are the highest addresses, which would sit above the table.
      wrap.append(el('p', 'storage-empty', `${v.hidden} more doubleword${v.hidden === 1 ? '' : 's'} above (not shown).`));
    }
    wrap.append(table);
    return wrap;
  }
}
