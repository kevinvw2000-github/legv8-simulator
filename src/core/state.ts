// Machine state: registers, sparse byte memory, flags, PC, and access tracking.
// Tracking mirrors zyBooks: any register or byte that is read or written becomes a
// visible entry (value 0 if never written).

import { formatSigned, u64 } from './bits';
import { REGISTER_INDEX, REGISTER_NAMES } from './isa';

export const XZR = 31;
/** Largest valid byte address in zyBooks' ARM memory (2^62 − 1). */
export const MAX_ADDRESS = (1n << 62n) - 1n;

export type Mode = 'zybooks' | 'arm';

export interface Flags {
  N: boolean;
  Z: boolean;
  C: boolean;
  V: boolean;
}

/** Thrown during execution; becomes "Error: <instruction>. <message>". */
export class ExecError extends Error {}

export class MachineState {
  readonly regs: bigint[] = new Array<bigint>(32).fill(0n);
  /** Registers read or written (shown in the panel). */
  readonly accessedRegs = new Set<number>();
  /** Registers written since the last clearChanges(). */
  readonly changedRegs = new Set<number>();

  /** Byte address → byte value. Presence means "accessed". */
  readonly memory = new Map<bigint, number>();
  /** 8-byte row addresses written since the last clearChanges(). */
  readonly changedRows = new Set<bigint>();

  flags: Flags = { N: false, Z: false, C: false, V: false };
  /** Index of the next instruction to execute. */
  pc = 0;
  steps = 0;

  constructor(readonly mode: Mode = 'zybooks') {}

  // ---- registers ----

  readReg(name: string): bigint {
    const i = regIndex(name);
    this.accessedRegs.add(i);
    return i === XZR ? 0n : (this.regs[i] as bigint);
  }

  /** Writes to XZR are silently ignored, as in zyBooks. */
  writeReg(name: string, value: bigint): void {
    const i = regIndex(name);
    this.accessedRegs.add(i);
    if (i === XZR) return;
    this.regs[i] = u64(value);
    this.changedRegs.add(i);
  }

  // ---- memory (little-endian) ----

  /**
   * Byte addresses `addr .. addr+size-1` (64-bit wraparound), creating a 0 entry for each
   * one not seen before. Throws on the first invalid byte. Like zyBooks, the error shows
   * the address as an unsigned 64-bit number.
   */
  private touch(addr: bigint, size: number): bigint[] {
    const out: bigint[] = [];
    for (let i = 0; i < size; i++) {
      const a = u64(addr + BigInt(i));
      if (!this.memory.has(a)) {
        if (a > MAX_ADDRESS) throw new ExecError(`Invalid address: ${a}`);
        this.memory.set(a, 0);
      }
      out.push(a);
    }
    return out;
  }

  /** Read `size` bytes starting at `addr` as an unsigned little-endian value. */
  readMem(addr: bigint, size: number): bigint {
    return this.touch(addr, size).reduce(
      (v, a, i) => v | (BigInt(this.memory.get(a) as number) << BigInt(8 * i)),
      0n,
    );
  }

  /** Write the low `size` bytes of `value`. All bytes are validated before any is written. */
  writeMem(addr: bigint, size: number, value: bigint): void {
    this.touch(addr, size).forEach((a, i) => {
      this.memory.set(a, Number((value >> BigInt(8 * i)) & 0xffn));
      this.changedRows.add(a - (a % 8n));
    });
  }

  clearChanges(): void {
    this.changedRegs.clear();
    this.changedRows.clear();
  }

  // ---- display ----

  /** Accessed registers in index order, as signed decimal. */
  registerView(): Array<{ name: string; value: string; changed: boolean }> {
    return [...this.accessedRegs]
      .sort((a, b) => a - b)
      .map((i) => ({
        name: REGISTER_NAMES[i] as string,
        value: formatSigned(i === XZR ? 0n : (this.regs[i] as bigint)),
        changed: this.changedRegs.has(i),
      }));
  }

  /** Accessed memory grouped into 8-byte rows, as signed decimal doublewords. */
  memoryView(): Array<{ address: string; value: string; changed: boolean }> {
    const rows = [...new Set([...this.memory.keys()].map((a) => a - (a % 8n)))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return rows.map((row) => {
      let v = 0n;
      for (let i = 0; i < 8; i++) {
        v |= BigInt(this.memory.get(row + BigInt(i)) ?? 0) << BigInt(8 * i);
      }
      return { address: row.toString(), value: formatSigned(v), changed: this.changedRows.has(row) };
    });
  }
}

function regIndex(name: string): number {
  const i = REGISTER_INDEX[name];
  if (i === undefined) throw new ExecError(`Invalid register name: ${name}`);
  return i;
}
