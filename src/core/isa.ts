// LEGv8 instruction set: mnemonics, operand formats and validation rules.
// Behavior matches the zyBooks simulator (see docs/COMPATIBILITY.md).

/** Token kinds produced by the lexer (spaces and comments are dropped before parsing). */
export type TokenKind =
  | 'label'
  | 'comma'
  | 'register'
  | 'openBracket'
  | 'closeBracket'
  | 'hash'
  | 'number'
  | 'word';

/**
 * Operand formats.
 * R:  OP Xd, Xn, Xm
 * I:  OP Xd, Xn, #imm            (imm: 11-bit signed)
 * D:  OP Xt, [Xn, #off]          (off: 9-bit signed)
 * B:  OP label
 * CB: OP Xt, label
 * BR: OP Xn
 * IM: OP Xd, imm, LSL shift      (imm: 16-bit signed, shift ∈ {0,16,32,48}; no '#')
 */
export type Format = 'R' | 'I' | 'D' | 'B' | 'CB' | 'BR' | 'IM';

export const FORMAT_TOKENS: Record<Format, readonly TokenKind[]> = {
  R: ['register', 'comma', 'register', 'comma', 'register'],
  I: ['register', 'comma', 'register', 'comma', 'hash', 'number'],
  D: ['register', 'comma', 'openBracket', 'register', 'comma', 'hash', 'number', 'closeBracket'],
  B: ['word'],
  CB: ['register', 'comma', 'word'],
  BR: ['register'],
  IM: ['register', 'comma', 'number', 'comma', 'word', 'number'],
};

export const MNEMONIC_FORMAT: Readonly<Record<string, Format>> = {
  ADD: 'R', ADDS: 'R', SUB: 'R', SUBS: 'R', AND: 'R', ORR: 'R', EOR: 'R', MUL: 'R', SDIV: 'R',
  ADDI: 'I', ADDIS: 'I', SUBI: 'I', SUBIS: 'I', ANDI: 'I', ORRI: 'I', EORI: 'I', LSL: 'I', LSR: 'I',
  LDUR: 'D', LDURB: 'D', LDURH: 'D', LDURSW: 'D', STUR: 'D', STURB: 'D', STURH: 'D', STURW: 'D',
  B: 'B', BL: 'B',
  'B.EQ': 'B', 'B.NE': 'B', 'B.HS': 'B', 'B.LO': 'B', 'B.MI': 'B', 'B.PL': 'B', 'B.VS': 'B',
  'B.VC': 'B', 'B.HI': 'B', 'B.LS': 'B', 'B.GE': 'B', 'B.LT': 'B', 'B.GT': 'B', 'B.LE': 'B',
  CBZ: 'CB', CBNZ: 'CB',
  BR: 'BR',
  MOVZ: 'IM', MOVK: 'IM',
};

export const REGISTER_NAMES: readonly string[] = [
  ...Array.from({ length: 31 }, (_, i) => `X${i}`),
  'XZR',
];

/** Index of each register (XZR = 31). */
export const REGISTER_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  REGISTER_NAMES.map((name, i) => [name, i]),
);

/** Inclusive range of an N-bit two's-complement constant. */
export function signedRange(bits: number): [number, number] {
  const half = 2 ** (bits - 1);
  return [-half, half - 1];
}

export const IMMEDIATE_BITS = { I: 11, D: 9, IM: 16 } as const;
export const MOV_SHIFTS: readonly number[] = [0, 16, 32, 48];

/** A parsed, validated instruction. Operand slots depend on the format. */
export type Instruction =
  | { format: 'R'; op: string; line: number; rd: string; rn: string; rm: string }
  | { format: 'I'; op: string; line: number; rd: string; rn: string; imm: number }
  | { format: 'D'; op: string; line: number; rt: string; rn: string; offset: number }
  | { format: 'B'; op: string; line: number; label: string }
  | { format: 'CB'; op: string; line: number; rt: string; label: string }
  | { format: 'BR'; op: string; line: number; rn: string }
  | { format: 'IM'; op: string; line: number; rd: string; imm: number; shift: number };

/** Text form used inside runtime error messages, matching zyBooks exactly. */
export function instructionToString(ins: Instruction): string {
  switch (ins.format) {
    case 'R':
      return `${ins.op} ${ins.rd}, ${ins.rn}, ${ins.rm}`;
    case 'I':
      return `${ins.op} ${ins.rd}, ${ins.rn}, #${ins.imm}`;
    case 'D':
      return `${ins.op} ${ins.rt}, [${ins.rn}, #${ins.offset}]`;
    case 'B':
      return `${ins.op} ${ins.label}`;
    case 'CB':
      // zyBooks prints CB instructions without the comma.
      return `${ins.op} ${ins.rt} ${ins.label}`;
    case 'BR':
      return `${ins.op} ${ins.rn}`;
    case 'IM':
      return `${ins.op} ${ins.rd}, ${ins.imm}, LSL ${ins.shift}`;
  }
}
