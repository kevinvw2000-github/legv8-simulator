// Expected results: register and memory values the user expects when the program ends, in the
// zyBooks import pair format ("X0 15, X9 -1" and "5000 1, 5008 350"). This is a self-check
// against values the user entered, not a reproduction of how zyBooks scores labs.

import { parseValue, s64 } from './bits';
import { REGISTER_INDEX, REGISTER_NAMES } from './isa';
import { MAX_ADDRESS, XZR, type MachineState } from './state';

export type ExpectedKind = 'registers' | 'memory';

export interface ExpectedEntry {
  /** Register name, or decimal doubleword address. */
  key: string;
  /** Unsigned 64-bit value. */
  value: bigint;
}

const MIN_S64 = -(1n << 63n);
const MAX_U64 = (1n << 64n) - 1n;

/** Parse one expected-values field. An empty field means nothing is expected. */
export function parseExpected(kind: ExpectedKind, text: string): { entries: ExpectedEntry[] } | { error: string } {
  const entries: ExpectedEntry[] = [];
  if (text.trim() === '') return { entries };
  const seen = new Set<string>();
  for (const part of text.split(',')) {
    const bits = part.trim().split(/\s+/);
    if (bits.length !== 2 || bits[0] === '') {
      const example = kind === 'registers' ? 'X0 15, X9 -1' : '5000 1, 5008 350';
      return { error: `Use pairs separated by commas, e.g. ${example}` };
    }
    let [key, value] = bits as [string, string];
    if (kind === 'registers') {
      key = key.toUpperCase();
      if (REGISTER_INDEX[key] === undefined) return { error: `${bits[0]} isn't a register (X0–X30 or XZR).` };
    } else {
      if (!/^\d+$/.test(key)) return { error: `${key} isn't an address.` };
      if (BigInt(key) > MAX_ADDRESS) return { error: `${key} is past the largest address.` };
      if (BigInt(key) % 8n !== 0n) return { error: `${key} isn't a multiple of 8 (doublewords start at 0, 8, 16, …).` };
      key = BigInt(key).toString();
    }
    if (!/^-?\d+$/.test(value) || BigInt(value) < MIN_S64 || BigInt(value) > MAX_U64) {
      return { error: `${value} isn't a 64-bit whole number.` };
    }
    if (seen.has(key)) return { error: `${key} is listed twice.` };
    seen.add(key);
    entries.push({ key, value: parseValue(value) });
  }
  return { entries };
}

export interface CheckResult {
  kind: ExpectedKind;
  key: string;
  expected: bigint;
  actual: bigint;
  /** False when the program never read or wrote it (it reads as 0, like zyBooks). */
  accessed: boolean;
  ok: boolean;
}

/** Compare the machine's current values with the expected ones, without marking anything accessed. */
export function checkExpected(
  st: MachineState,
  registers: ExpectedEntry[],
  memory: ExpectedEntry[],
): CheckResult[] {
  const out: CheckResult[] = [];
  for (const e of registers) {
    const i = REGISTER_INDEX[e.key]!;
    const actual = i === XZR ? 0n : st.regs[i]!;
    out.push({ kind: 'registers', key: e.key, expected: e.value, actual, accessed: st.accessedRegs.has(i), ok: actual === e.value });
  }
  for (const e of memory) {
    const { value, present } = st.peekDoubleword(BigInt(e.key));
    out.push({ kind: 'memory', key: e.key, expected: e.value, actual: value, accessed: present, ok: value === e.value });
  }
  return out;
}

/** One line for the console, e.g. "Expected values: 8 of 9 match. X9 is 0, expected -1." */
export function summarize(results: CheckResult[]): string {
  const bad = results.filter((r) => !r.ok);
  if (bad.length === 0) {
    return results.length === 1 ? 'Expected value matches.' : `Expected values: all ${results.length} match.`;
  }
  const name = (r: CheckResult) => (r.kind === 'registers' ? r.key : `Memory ${r.key}`);
  const shown = bad.slice(0, 3).map((r) => `${name(r)} is ${s64(r.actual)}, expected ${s64(r.expected)}`);
  const more = bad.length > 3 ? ` (and ${bad.length - 3} more)` : '';
  return `Expected values: ${results.length - bad.length} of ${results.length} match. ${shown.join('; ')}${more}.`;
}

/** Sort keys the way the panels list them: registers by number, memory by address. */
export function keyOrder(kind: ExpectedKind, key: string): bigint {
  return kind === 'registers' ? BigInt(REGISTER_NAMES.indexOf(key)) : BigInt(key);
}
