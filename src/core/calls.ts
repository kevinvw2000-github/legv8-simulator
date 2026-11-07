// Call-stack and stack-memory tracking. LEGv8 has no hardware call stack, so it is inferred:
// BL pushes a frame and a BR to a frame's return address pops it (and any frames above it).
// A BR X30 that goes anywhere else is flagged, because it usually means X30 was overwritten by
// a nested BL without being saved and restored. BR through other registers (e.g. jump tables)
// is left alone.

import { imm64, u64 } from './bits';
import type { Instruction } from './isa';
import type { Program } from './parser';
import { MAX_ADDRESS, type Frame, type MachineState, type StoreOrigin } from './state';

const SP = 28;
const STORE_SIZE: Readonly<Record<string, number>> = { STUR: 8, STURW: 4, STURH: 2, STURB: 1 };
const REG_INDEX = (name: string): number => (name === 'XZR' ? 31 : Number(name.slice(1)));

/** Bytes a store is about to write, captured before it executes. */
export interface PendingStore {
  addr: bigint;
  size: number;
  reg: string;
}

/** Call before executing `ins`: where a store will write (registers may change afterwards). */
export function pendingStore(st: MachineState, ins: Instruction): PendingStore | null {
  if (ins.format !== 'D') return null;
  const size = STORE_SIZE[ins.op];
  if (size === undefined) return null;
  const base = st.regs[REG_INDEX(ins.rn)] ?? 0n;
  return { addr: u64(base + imm64(ins.offset)), size, reg: ins.rt };
}

/** Describe a code address for messages, e.g. "line 7 (0x18)". */
export function describeCodeAddress(program: Program, addr: bigint): string {
  const hex = `0x${addr.toString(16).toUpperCase()}`;
  if (addr % 4n !== 0n) return `address ${hex}`;
  const index = addr / 4n;
  const n = BigInt(program.instructions.length);
  if (index === n) return `the end of the program (${hex})`;
  if (index > n) return `address ${hex}`;
  return `line ${program.instructions[Number(index)]!.line} (${hex})`;
}

/**
 * The top of the stack is the first valid, non-zero X28: the starting value, or the first one
 * the program sets. Call once at start and after every step.
 */
export function noteStackPointer(st: MachineState): void {
  if (st.stackTop !== null) return;
  const sp = st.regs[SP] ?? 0n;
  if (sp !== 0n && sp <= MAX_ADDRESS) st.stackTop = sp;
}

/** Update call tracking after `ins` (at index `pc`) executed successfully. */
export function traceStep(
  st: MachineState,
  program: Program,
  ins: Instruction,
  pc: number,
  store: PendingStore | null,
): void {
  if (store) {
    // Any doubleword this store overlaps no longer holds what was saved there.
    for (let a = store.addr - 7n; a < store.addr + BigInt(store.size); a++) {
      if (st.storeOrigins.has(u64(a))) st.setOrigin(u64(a), undefined);
    }
    if (store.size === 8) st.setOrigin(store.addr, { reg: store.reg, pc } satisfies StoreOrigin);
  }

  if (ins.format === 'B' && ins.op === 'BL') {
    const frame: Frame = {
      label: ins.label,
      callPc: pc,
      returnAddress: BigInt(pc + 1) * 4n,
      spAtCall: st.regs[SP] ?? 0n,
    };
    st.callStack = [...st.callStack, frame];
    st.callWarning = null;
  } else if (ins.format === 'BR') {
    const target = st.regs[REG_INDEX(ins.rn)] ?? 0n;
    const stack = st.callStack;
    let i = stack.length - 1;
    while (i >= 0 && stack[i]!.returnAddress !== target) i--;
    if (i >= 0) {
      const skipped = stack.length - 1 - i;
      st.callStack = stack.slice(0, i);
      st.callWarning =
        skipped === 0
          ? null
          : `Returned from ${stack[i]!.label}, but ${skipped} call${skipped === 1 ? '' : 's'} made inside it ` +
            `(${stack.slice(i + 1).map((f) => f.label).join(', ')}) never returned.`;
    } else if (ins.rn === 'X30' && stack.length > 0) {
      const top = stack[stack.length - 1]!;
      st.callWarning =
        `BR X30 went to ${describeCodeAddress(program, target)}, but ${top.label} should return to ` +
        `${describeCodeAddress(program, top.returnAddress)}. X30 may have been overwritten by a ` +
        `nested BL without being saved and restored.`;
    }
  }
}

// ---------- views for the UI ----------

export interface FrameView {
  label: string;
  /** 1 for the outermost active call, increasing inward. */
  depth: number;
  callLine: number;
  /** Where it returns, e.g. "line 7 (0x18)". */
  returnsTo: string;
}

/** Active calls, innermost first. */
export function callStackView(st: MachineState, program: Program): FrameView[] {
  return st.callStack.map((f, i) => ({
    label: f.label,
    depth: i + 1,
    callLine: program.instructions[f.callPc]?.line ?? 0,
    returnsTo: describeCodeAddress(program, f.returnAddress),
  })).reverse();
}

export interface StackRow {
  address: bigint;
  /** Unsigned 64-bit value. */
  value: bigint;
  /** False when no byte of this doubleword has been accessed yet. */
  present: boolean;
  /** Byte offset from SP. */
  offset: bigint;
  /** "saved X30 (line 9)", when a STUR put a register here. */
  note: string | null;
  /** The call this slot belongs to, or null for the top level. */
  owner: { label: string; depth: number } | null;
}

export interface StackView {
  sp: bigint;
  top: bigint | null;
  rows: StackRow[];
  /** Rows not shown because the stack is deeper than `maxRows`. */
  hidden: number;
}

/** "saved X30 (line 6) → line 11": for X30, also where the saved address points. */
function originNote(program: Program, origin: StoreOrigin, value: bigint): string {
  const note = `saved ${origin.reg} (line ${program.instructions[origin.pc]?.line ?? '?'})`;
  if (origin.reg !== 'X30') return note;
  const where = describeCodeAddress(program, value).replace(/ \(0x[0-9A-F]+\)$/, '');
  return `${note} → ${where}`;
}

/**
 * Doublewords from SP up to the top of the stack area (see noteStackPointer), without
 * marking anything accessed.
 */
export function stackView(st: MachineState, program: Program, maxRows = 64): StackView {
  const sp = st.regs[SP] ?? 0n;
  const top = st.stackTop;
  const rows: StackRow[] = [];
  let hidden = 0;
  if (top !== null && sp < top && sp <= MAX_ADDRESS) {
    const count = (top - sp + 7n) / 8n;
    const shown = count > BigInt(maxRows) ? BigInt(maxRows) : count;
    hidden = Number(count - shown);
    const frames = st.callStack;
    for (let k = 0n; k < shown; k++) {
      const address = sp + k * 8n;
      const { value, present } = st.peekDoubleword(address);
      const origin = st.storeOrigins.get(address);
      // The innermost call whose SP-at-call is above this slot owns it.
      let owner: StackRow['owner'] = null;
      for (let f = frames.length - 1; f >= 0; f--) {
        if (address < frames[f]!.spAtCall) {
          owner = { label: frames[f]!.label, depth: f + 1 };
          break;
        }
      }
      rows.push({
        address,
        value,
        present,
        offset: k * 8n,
        note: origin ? originNote(program, origin, value) : null,
        owner,
      });
    }
  }
  return { sp, top, rows, hidden };
}
