// Editor hover while simulating: rest the pointer on a register (or on a load/store's
// [Xn, #off]) to see its current value. The tooltip re-reads the machine on every editor
// update, so it stays live while a program runs.

import type { Extension } from '@codemirror/state';
import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { formatValue, s64, type ValueFormat } from '../core/bits';
import { findHoverTarget, memoryInfo, registerInfo, type HoverTarget } from '../core/hover';
import type { Program } from '../core/parser';
import type { MachineState } from '../core/state';

export interface HoverContext {
  st: MachineState;
  program: Program;
  format: ValueFormat;
  /** When the value is from: "now", "before line 4 runs", "at the end of the program", … */
  when: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

const FORMATS: ReadonlyArray<readonly [string, ValueFormat]> = [
  ['Decimal', 'signed'],
  ['Unsigned', 'unsigned'],
  ['Hex', 'hex'],
  ['Binary', 'binary'],
];

/** The value in every format, with the one chosen in "Show values as" emphasized. */
function valueGrid(value: bigint, format: ValueFormat): HTMLElement {
  const grid = el('div', 'hv-grid');
  for (const [label, f] of FORMATS) {
    grid.append(el('span', 'hv-label', label), el('span', f === format ? 'hv-val hv-on' : 'hv-val', formatValue(value, f)));
  }
  return grid;
}

const SIZE_NAME: Readonly<Record<number, string>> = { 8: 'doubleword', 4: 'word', 2: 'halfword', 1: 'byte' };

function build(target: HoverTarget, ctx: HoverContext): HTMLElement[] {
  const parts: HTMLElement[] = [];
  if (target.kind === 'register') {
    const r = registerInfo(ctx.st, ctx.program, target.name);
    const head = el('div', 'hv-head');
    head.append(el('strong', undefined, r.name));
    if (r.role) head.append(el('span', 'hv-role', r.role));
    parts.push(head, valueGrid(r.value, ctx.format));
    parts.push(el('div', 'hv-foot', r.used ? `Value ${ctx.when}` : `Not used yet (reads as 0) · ${ctx.when}`));
    return parts;
  }

  const m = memoryInfo(ctx.st, target);
  const sign = m.offset < 0 ? '−' : '+';
  const how = `${m.base} (${s64(m.baseValue)}) ${sign} ${Math.abs(m.offset)}`;
  const head = el('div', 'hv-head');
  head.append(el('strong', undefined, `Address ${m.address}`));
  if (m.address >= 1n << 63n) head.append(el('span', 'hv-role', `${s64(m.address)} as signed`));
  parts.push(head, el('div', 'hv-sub', `= ${how}`));
  if (!m.valid) {
    parts.push(el('div', 'hv-error', `Not a valid address, so ${m.op} will stop the program.`));
    return parts;
  }
  const noun = SIZE_NAME[m.size]!;
  parts.push(el('div', 'hv-sub', m.store ? `The ${noun} there now (${m.op} will overwrite it):` : `The ${noun} ${m.op} loads:`));
  parts.push(valueGrid(m.value, ctx.format));
  parts.push(el('div', 'hv-foot', m.present ? `Value ${ctx.when}` : `Not accessed yet (reads as 0) · ${ctx.when}`));
  return parts;
}

/** `getContext` returns null when not simulating, which turns the hover off. */
export function simulationHover(getContext: () => HoverContext | null): Extension {
  return hoverTooltip(
    (view, pos, side): Tooltip | null => {
      if (!getContext()) return null;
      const line = view.state.doc.lineAt(pos);
      const target = findHoverTarget(line.text, pos - line.from - (side < 0 ? 1 : 0));
      if (!target) return null;
      return {
        pos: line.from + target.from,
        end: line.from + target.to,
        above: true,
        create: () => {
          const dom = el('div', 'hv');
          const fill = () => {
            const ctx = getContext();
            dom.hidden = !ctx;
            if (ctx) dom.replaceChildren(...build(target, ctx));
          };
          fill();
          return { dom, update: fill };
        },
      };
    },
    { hoverTime: 200 },
  );
}
