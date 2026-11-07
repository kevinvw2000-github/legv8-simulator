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

/** One active procedure call, pushed by BL and popped by a BR to its return address. */
export interface Frame {
  /** Label BL jumped to. */
  label: string;
  /** Index of the BL instruction. */
  callPc: number;
  /** Byte address BL put in X30. */
  returnAddress: bigint;
  /** X28 (stack pointer) when BL ran. Stack below this belongs to the call. */
  spAtCall: bigint;
}

/** Which register a STUR saved at an address, and the instruction that did it. */
export interface StoreOrigin {
  reg: string;
  pc: number;
}

/** Call-tracking fields, saved whole in each step record (they are small and replaced, not mutated). */
export interface CallTrace {
  callStack: readonly Frame[];
  callWarning: string | null;
  stackTop: bigint | null;
}

/**
 * What one step changed, so it can be undone. Only the first old value of each register or
 * byte is kept. A byte whose old value is `undefined` didn't exist before the step.
 */
export interface StepRecord {
  pc: number;
  steps: number;
  flags: Flags;
  regs: Map<number, bigint>;
  newlyAccessedRegs: number[];
  bytes: Map<bigint, number | undefined>;
  /** Change highlighting from before the step (it shows what the previous step changed). */
  changedRegs: number[];
  changedRows: bigint[];
  trace: CallTrace;
  origins: Map<bigint, StoreOrigin | undefined>;
}

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

  // ---- call tracking (inferred from BL/BR; see Machine) ----
  callStack: readonly Frame[] = [];
  /** Set when a BR X30 doesn't go where the innermost call should return. */
  callWarning: string | null = null;
  /** First valid, non-zero X28: the top of the stack area. */
  stackTop: bigint | null = null;
  /** Doubleword address → what STUR stored there. */
  readonly storeOrigins = new Map<bigint, StoreOrigin>();

  /** While a step runs, the record its changes are logged into. */
  private record: StepRecord | null = null;

  constructor(readonly mode: Mode = 'zybooks') {}

  // ---- undo ----

  /** Start logging changes for one step. Call before clearChanges(). */
  beginRecord(): void {
    this.record = {
      pc: this.pc,
      steps: this.steps,
      flags: { ...this.flags },
      regs: new Map(),
      newlyAccessedRegs: [],
      bytes: new Map(),
      changedRegs: [...this.changedRegs],
      changedRows: [...this.changedRows],
      trace: { callStack: this.callStack, callWarning: this.callWarning, stackTop: this.stackTop },
      origins: new Map(),
    };
  }

  /** Set or clear the store origin of a doubleword address, logging it for undo. */
  setOrigin(addr: bigint, origin: StoreOrigin | undefined): void {
    if (this.record && !this.record.origins.has(addr)) this.record.origins.set(addr, this.storeOrigins.get(addr));
    if (origin) this.storeOrigins.set(addr, origin);
    else this.storeOrigins.delete(addr);
  }

  /** Read a doubleword without marking it accessed (for inspection panels). */
  peekDoubleword(addr: bigint): { value: bigint; present: boolean } {
    let value = 0n;
    let present = false;
    for (let i = 0; i < 8; i++) {
      const b = this.memory.get(u64(addr + BigInt(i)));
      if (b !== undefined) present = true;
      value |= BigInt(b ?? 0) << BigInt(8 * i);
    }
    return { value, present };
  }

  /** Stop logging and return what the step changed. */
  endRecord(): StepRecord {
    const r = this.record;
    if (!r) throw new Error('No step is being recorded');
    this.record = null;
    return r;
  }

  /** Put the state back exactly as it was before the recorded step. */
  undo(r: StepRecord): void {
    for (const [i, v] of r.regs) this.regs[i] = v;
    for (const i of r.newlyAccessedRegs) this.accessedRegs.delete(i);
    for (const [a, v] of r.bytes) {
      if (v === undefined) this.memory.delete(a);
      else this.memory.set(a, v);
    }
    this.flags = { ...r.flags };
    this.pc = r.pc;
    this.steps = r.steps;
    this.changedRegs.clear();
    for (const i of r.changedRegs) this.changedRegs.add(i);
    this.changedRows.clear();
    for (const row of r.changedRows) this.changedRows.add(row);
    ({ callStack: this.callStack, callWarning: this.callWarning, stackTop: this.stackTop } = r.trace);
    for (const [a, o] of r.origins) {
      if (o) this.storeOrigins.set(a, o);
      else this.storeOrigins.delete(a);
    }
  }

  private access(i: number): void {
    if (this.accessedRegs.has(i)) return;
    this.accessedRegs.add(i);
    this.record?.newlyAccessedRegs.push(i);
  }

  private logByte(a: bigint): void {
    if (this.record && !this.record.bytes.has(a)) this.record.bytes.set(a, this.memory.get(a));
  }

  // ---- registers ----

  readReg(name: string): bigint {
    const i = regIndex(name);
    this.access(i);
    return i === XZR ? 0n : (this.regs[i] as bigint);
  }

  /** Writes to XZR are silently ignored, as in zyBooks. */
  writeReg(name: string, value: bigint): void {
    const i = regIndex(name);
    this.access(i);
    if (i === XZR) return;
    if (this.record && !this.record.regs.has(i)) this.record.regs.set(i, this.regs[i] as bigint);
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
        this.logByte(a);
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
      this.logByte(a);
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
