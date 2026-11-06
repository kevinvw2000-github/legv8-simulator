// Instruction semantics. Each step executes one instruction and returns the next PC.
//
// Mode 'zybooks' reproduces the reference simulator's observable quirks
// (docs/COMPATIBILITY.md, confirmed by probes P1–P3):
//   1. ADDS/SUBS/ADDIS/SUBIS compute flags *after* writing Rd, re-reading the sources.
//   2. SUBIS computes carry with a signed comparison against the immediate.
//   3. SDIV ignores bits 32–39 of both operands.
//   4. MOVK ORs in the sign-extended immediate (negative values set the high bits).
// Mode 'arm' uses architecturally correct behavior for all four.

import { MASK64, imm64, isNeg, s64, u64 } from './bits';
import type { Instruction } from './isa';
import type { Program } from './parser';
import { ExecError, type Flags, type MachineState } from './state';

// ---------- flags ----------

function addFlags(a: bigint, b: bigint): Flags {
  const r = u64(a + b);
  return {
    N: isNeg(r),
    Z: r === 0n,
    C: a + b > MASK64,
    V: isNeg(a) === isNeg(b) && isNeg(r) !== isNeg(a),
  };
}

function subFlags(a: bigint, b: bigint): Flags {
  const r = u64(a - b);
  return {
    N: isNeg(r),
    Z: r === 0n,
    C: a >= b,
    V: isNeg(a) !== isNeg(b) && isNeg(r) !== isNeg(a),
  };
}

/**
 * zyBooks SUBIS carry: the immediate (signed) is compared to the register value with a
 * signed-style test. imm < 0 → C = 1; imm = value → C = 1; otherwise C = bit 63 of (imm − value).
 */
function zybooksSubisCarry(value: bigint, imm: number): boolean {
  if (imm < 0) return true;
  const d = u64(BigInt(imm) - value);
  return d === 0n || isNeg(d);
}

// ---------- SDIV ----------

/** zyBooks reads SDIV operands with bits 32–39 dropped. */
const sdivOperand = (v: bigint, mode: MachineState['mode']): bigint =>
  mode === 'zybooks' ? s64(v & ~(0xffn << 32n)) : s64(v);

function sdiv(a: bigint, b: bigint, mode: MachineState['mode']): bigint {
  const x = sdivOperand(a, mode);
  const y = sdivOperand(b, mode);
  if (y === 0n) throw new ExecError('division by zero');
  return u64(x / y); // BigInt division truncates toward zero; MIN / −1 wraps to MIN.
}

// ---------- conditions ----------

const CONDITIONS: Record<string, (f: Flags) => boolean> = {
  'B.EQ': (f) => f.Z,
  'B.NE': (f) => !f.Z,
  'B.HS': (f) => f.C,
  'B.LO': (f) => !f.C,
  'B.MI': (f) => f.N,
  'B.PL': (f) => !f.N,
  'B.VS': (f) => f.V,
  'B.VC': (f) => !f.V,
  'B.HI': (f) => f.C && !f.Z,
  'B.LS': (f) => !f.C || f.Z,
  'B.GE': (f) => f.N === f.V,
  'B.LT': (f) => f.N !== f.V,
  'B.GT': (f) => !f.Z && f.N === f.V,
  'B.LE': (f) => f.Z || f.N !== f.V,
};

/** Each instruction occupies 4 bytes of (virtual) instruction memory starting at 0. */
export const INSTRUCTION_BYTES = 4;

// ---------- loads / stores ----------

/** Size in bytes and kind of each D-format instruction. No alignment checks (like zyBooks). */
const DATA_ACCESS: Record<string, [number, 'load' | 'signed' | 'store']> = {
  LDUR: [8, 'load'],
  LDURSW: [4, 'signed'],
  LDURH: [2, 'load'],
  LDURB: [1, 'load'],
  STUR: [8, 'store'],
  STURW: [4, 'store'],
  STURH: [2, 'store'],
  STURB: [1, 'store'],
};

function signExtend(v: bigint, bytes: number): bigint {
  const bits = BigInt(8 * bytes);
  return v & (1n << (bits - 1n)) ? u64(v - (1n << bits)) : v;
}

// ---------- execution ----------

/** Execute `ins` (at index `pc`) and return the next PC. Throws ExecError on runtime errors. */
export function execute(ins: Instruction, pc: number, st: MachineState, program: Program): number {
  const zy = st.mode === 'zybooks';
  const next = pc + 1;

  switch (ins.format) {
    case 'R': {
      const a = st.readReg(ins.rn);
      const b = st.readReg(ins.rm);
      st.readReg(ins.rd);
      let r: bigint;
      switch (ins.op) {
        case 'ADD': case 'ADDS': r = a + b; break;
        case 'SUB': case 'SUBS': r = a - b; break;
        case 'AND': r = a & b; break;
        case 'ORR': r = a | b; break;
        case 'EOR': r = a ^ b; break;
        case 'MUL': r = a * b; break;
        case 'SDIV': r = sdiv(a, b, st.mode); break;
        default: throw new ExecError(`Unsupported instruction: ${ins.op}`);
      }
      st.writeReg(ins.rd, r);
      if (ins.op === 'ADDS' || ins.op === 'SUBS') {
        const [fa, fb] = zy ? [st.readReg(ins.rn), st.readReg(ins.rm)] : [a, b];
        st.flags = ins.op === 'ADDS' ? addFlags(fa, fb) : subFlags(fa, fb);
      }
      return next;
    }

    case 'I': {
      const a = st.readReg(ins.rn);
      st.readReg(ins.rd);
      const imm = imm64(ins.imm);
      const shift = BigInt(ins.imm & 63); // Only the low 6 bits are used, as in zyBooks.
      let r: bigint;
      switch (ins.op) {
        case 'ADDI': case 'ADDIS': r = a + imm; break;
        case 'SUBI': case 'SUBIS': r = a - imm; break;
        case 'ANDI': r = a & imm; break;
        case 'ORRI': r = a | imm; break;
        case 'EORI': r = a ^ imm; break;
        case 'LSL': r = a << shift; break;
        case 'LSR': r = a >> shift; break;
        default: throw new ExecError(`Unsupported instruction: ${ins.op}`);
      }
      st.writeReg(ins.rd, r);
      if (ins.op === 'ADDIS') {
        st.flags = addFlags(zy ? st.readReg(ins.rn) : a, imm);
      } else if (ins.op === 'SUBIS') {
        const fa = zy ? st.readReg(ins.rn) : a;
        st.flags = subFlags(fa, imm);
        if (zy) st.flags.C = zybooksSubisCarry(fa, ins.imm);
      }
      return next;
    }

    case 'IM': {
      const field = 0xffffn << BigInt(ins.shift);
      const imm = zy ? imm64(ins.imm) : BigInt(ins.imm) & 0xffffn;
      const shifted = u64(imm << BigInt(ins.shift));
      if (ins.op === 'MOVZ') {
        st.readReg(ins.rd);
        st.writeReg(ins.rd, shifted);
      } else {
        const old = st.readReg(ins.rd);
        st.writeReg(ins.rd, (old & ~field & MASK64) | (zy ? shifted : shifted & field));
      }
      return next;
    }

    case 'B': {
      const target = program.labels.get(ins.label) as number;
      if (ins.op === 'B') return target;
      if (ins.op === 'BL') {
        // Instruction memory starts at address 0 in zyBooks, so X30 = (pc + 1) * 4.
        st.writeReg('X30', BigInt(next * INSTRUCTION_BYTES));
        return target;
      }
      const cond = CONDITIONS[ins.op];
      if (!cond) throw new ExecError(`Unsupported instruction: ${ins.op}`);
      return cond(st.flags) ? target : next;
    }

    case 'D': {
      st.readReg(ins.rt);
      const addr = u64(st.readReg(ins.rn) + imm64(ins.offset));
      const access = DATA_ACCESS[ins.op];
      if (!access) throw new ExecError(`Unsupported instruction: ${ins.op}`);
      const [size, kind] = access;
      if (kind === 'store') {
        st.writeMem(addr, size, st.readReg(ins.rt));
      } else {
        const raw = st.readMem(addr, size);
        st.writeReg(ins.rt, kind === 'signed' ? signExtend(raw, size) : raw);
      }
      return next;
    }
    case 'CB': {
      const isZero = st.readReg(ins.rt) === 0n;
      const target = program.labels.get(ins.label) as number;
      return (ins.op === 'CBZ') === isZero ? target : next;
    }

    case 'BR': {
      const addr = st.readReg(ins.rn); // unsigned
      if (addr % BigInt(INSTRUCTION_BYTES) !== 0n) {
        throw new ExecError(`Instruction addresses should be word-aligned. Tried to access: ${addr}`);
      }
      // A target past the last instruction ends the program.
      const index = addr / BigInt(INSTRUCTION_BYTES);
      return index > BigInt(program.instructions.length) ? program.instructions.length : Number(index);
    }
  }
}
