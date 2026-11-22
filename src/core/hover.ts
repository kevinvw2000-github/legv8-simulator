// Hover inspection for the editor: what a register or a [Xn, #off] operand under the pointer
// holds right now. Everything here reads state without marking anything accessed, so hovering
// never adds rows to the Registers or Memory panels.

import { imm64, u64 } from './bits';
import { describeCodeAddress } from './calls';
import { REGISTER_INDEX } from './isa';
import type { Program } from './parser';
import { MAX_ADDRESS, XZR, type MachineState } from './state';

export type HoverTarget =
  | { kind: 'register'; name: string; from: number; to: number }
  | { kind: 'memory'; op: string; base: string; offset: number; from: number; to: number };

const REG = String.raw`X(?:30|[12]\d|\d)|XZR`;
const REGISTER = new RegExp(String.raw`\b(?:${REG})\b`, 'g');
const OPERAND = new RegExp(String.raw`\[\s*(${REG})\s*,\s*#(-?\d+)\s*\]`);
const MEM_OP = /\b(LDUR(?:B|H|SW)?|STUR(?:B|H|W)?)\b/;

/** Bytes each load/store touches. */
export const ACCESS_SIZE: Readonly<Record<string, number>> = {
  LDUR: 8, LDURB: 1, LDURH: 2, LDURSW: 4, STUR: 8, STURB: 1, STURH: 2, STURW: 4,
};

/**
 * What the pointer is over in one line of source: a register name, or the [Xn, #off] part of a
 * load/store (anywhere in the brackets that isn't the register itself). Comments are ignored.
 */
export function findHoverTarget(text: string, col: number): HoverTarget | null {
  const comment = text.indexOf('//');
  const code = comment >= 0 ? text.slice(0, comment) : text;
  if (col < 0 || col >= code.length) return null;
  for (const m of code.matchAll(REGISTER)) {
    const from = m.index!;
    if (col >= from && col < from + m[0].length) return { kind: 'register', name: m[0], from, to: from + m[0].length };
  }
  const operand = OPERAND.exec(code);
  const op = MEM_OP.exec(code);
  if (operand && op && op.index < operand.index) {
    const from = operand.index;
    const to = from + operand[0].length;
    if (col >= from && col < to) {
      return { kind: 'memory', op: op[1]!, base: operand[1]!, offset: Number(operand[2]), from, to };
    }
  }
  return null;
}

export interface RegisterInfo {
  name: string;
  /** Unsigned 64-bit value. */
  value: bigint;
  /** False until the program has read or written it (it reads as 0). */
  used: boolean;
  /** "stack pointer (SP)", "link register — returns to line 7 (0x18)", … */
  role: string | null;
}

const regValue = (st: MachineState, name: string): bigint => {
  const i = REGISTER_INDEX[name]!;
  return i === XZR ? 0n : st.regs[i]!;
};

export function registerInfo(st: MachineState, program: Program, name: string): RegisterInfo {
  const i = REGISTER_INDEX[name]!;
  const value = regValue(st, name);
  const used = i === XZR || st.accessedRegs.has(i);
  let role: string | null = null;
  if (i === XZR) role = 'always 0';
  else if (i === 28) role = 'stack pointer (SP)';
  else if (i === 30) {
    role = 'link register';
    if (used) {
      const where = describeCodeAddress(program, value);
      if (!where.startsWith('address')) role += ` — returns to ${where}`;
    }
  }
  return { name, value, used, role };
}

export interface MemoryInfo {
  op: string;
  base: string;
  baseValue: bigint;
  offset: number;
  /** Unsigned effective address. */
  address: bigint;
  size: number;
  store: boolean;
  /** False when some byte is past the largest address (the instruction would stop the program). */
  valid: boolean;
  /** Current contents, as a load would read them (unsigned, or sign-extended for LDURSW). */
  value: bigint;
  /** False when no byte has been accessed yet (reads as 0). */
  present: boolean;
}

export function memoryInfo(st: MachineState, t: Extract<HoverTarget, { kind: 'memory' }>): MemoryInfo {
  const baseValue = regValue(st, t.base);
  const address = u64(baseValue + imm64(t.offset));
  const size = ACCESS_SIZE[t.op]!;
  let valid = true;
  for (let k = 0; k < size; k++) if (u64(address + BigInt(k)) > MAX_ADDRESS) valid = false;
  let value = 0n;
  let present = false;
  if (valid) {
    ({ value, present } = st.peekBytes(address, size));
    if (t.op === 'LDURSW' && value & 0x8000_0000n) value = u64(value - (1n << 32n));
  }
  return { op: t.op, base: t.base, baseValue, offset: t.offset, address, size, store: t.op.startsWith('STUR'), valid, value, present };
}
