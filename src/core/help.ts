// Content for the Help panel. Syntax lines and number ranges are derived from the parser's own
// tables (isa.ts), and a test checks that every instruction the parser accepts has an entry here,
// so Help can't list something the simulator rejects (or miss something it accepts).

import { INSTEAD } from './fullmode';
import {
  EXTRA_MNEMONIC_FORMAT,
  FULL_RANGES,
  IMMEDIATE_BITS,
  MNEMONIC_FORMAT,
  MOV_SHIFTS,
  signedRange,
  type Format,
} from './isa';
import type { Mode } from './state';

/** The modes' behavior comes in two flavors: zyBooks' quirks, or real ARM (also used by Full LEGv8). */
export const behaviorOf = (mode: Mode): 'zybooks' | 'arm' => (mode === 'zybooks' ? 'zybooks' : 'arm');

export type HelpGroup = 'Arithmetic' | 'Logic and shifts' | 'Load and store' | 'Branches' | 'Move';
export const HELP_GROUPS: readonly HelpGroup[] = ['Arithmetic', 'Logic and shifts', 'Load and store', 'Branches', 'Move'];

export interface HelpEntry {
  group: HelpGroup;
  /** One line: what it does. */
  meaning: string;
  /** A line that parses on its own once a label named Loop exists (the Insert button adds it). */
  example: string;
  /** Updates N, Z, C and V. */
  setsFlags?: boolean;
  /** Decides by reading N, Z, C and V. */
  readsFlags?: boolean;
  /** Where behavior differs between the modes. Only the notes for modes that differ are given. */
  modeNote?: Partial<Record<Mode, string>>;
  /** Modes that include the instruction (all of them when omitted). */
  modes?: readonly Mode[];
  /** For shorthands: the real instruction(s) they stand for. */
  alias?: string;
}

const FULL_ONLY: readonly Mode[] = ['full'];

const FLAGS_AFTER: Partial<Record<Mode, string>> = {
  zybooks:
    'zyBooks quirk: the flags are computed after Xd is written, from the sources’ new values. ' +
    'If Xd is also a source, the flags compare the result instead of the original value.',
  arm: 'Real ARM: the flags are computed from the original source values, even if Xd is also a source.',
};

export const HELP: Readonly<Record<string, HelpEntry>> = {
  ADD: { group: 'Arithmetic', meaning: 'Xd = Xn + Xm', example: 'ADD X1, X2, X3' },
  ADDS: { group: 'Arithmetic', meaning: 'Xd = Xn + Xm, and set the flags', example: 'ADDS X1, X2, X3', setsFlags: true, modeNote: FLAGS_AFTER },
  SUB: { group: 'Arithmetic', meaning: 'Xd = Xn − Xm', example: 'SUB X1, X2, X3' },
  SUBS: { group: 'Arithmetic', meaning: 'Xd = Xn − Xm, and set the flags. SUBS XZR, Xn, Xm compares two registers.', example: 'SUBS XZR, X2, X3', setsFlags: true, modeNote: FLAGS_AFTER },
  ADDI: { group: 'Arithmetic', meaning: 'Xd = Xn + imm', example: 'ADDI X1, X2, #1' },
  ADDIS: { group: 'Arithmetic', meaning: 'Xd = Xn + imm, and set the flags', example: 'ADDIS X1, X2, #1', setsFlags: true, modeNote: FLAGS_AFTER },
  SUBI: { group: 'Arithmetic', meaning: 'Xd = Xn − imm', example: 'SUBI X1, X2, #1' },
  SUBIS: {
    group: 'Arithmetic',
    meaning: 'Xd = Xn − imm, and set the flags. SUBIS XZR, Xn, #imm compares a register with a number.',
    example: 'SUBIS XZR, X2, #1',
    setsFlags: true,
    modeNote: {
      zybooks:
        FLAGS_AFTER.zybooks +
        ' The carry flag (C) acts like a signed comparison with the immediate: a negative immediate always sets C.',
      arm: FLAGS_AFTER.arm + ' C follows real ARM (set when Xn ≥ imm as unsigned numbers).',
    },
  },
  MUL: { group: 'Arithmetic', meaning: 'Xd = the low 64 bits of Xn × Xm', example: 'MUL X1, X2, X3' },
  SDIV: {
    group: 'Arithmetic',
    meaning: 'Xd = Xn ÷ Xm, signed, rounded toward zero. Dividing by zero stops the program with an error.',
    example: 'SDIV X1, X2, X3',
    modeNote: {
      zybooks:
        'zyBooks quirk: acts as if bits 32–39 of both values were cleared. Values from 0 to 2^32 − 1 are ' +
        'unaffected, but −7 ÷ 2 gives −547608330243 instead of −3.',
      arm: 'Real ARM: a plain signed 64-bit divide, so −7 ÷ 2 gives −3.',
    },
  },

  AND: { group: 'Logic and shifts', meaning: 'Xd = Xn AND Xm (bit by bit)', example: 'AND X1, X2, X3' },
  ORR: { group: 'Logic and shifts', meaning: 'Xd = Xn OR Xm (bit by bit)', example: 'ORR X1, X2, X3' },
  EOR: { group: 'Logic and shifts', meaning: 'Xd = Xn XOR Xm (bit by bit)', example: 'EOR X1, X2, X3' },
  ANDI: { group: 'Logic and shifts', meaning: 'Xd = Xn AND imm', example: 'ANDI X1, X2, #255' },
  ORRI: { group: 'Logic and shifts', meaning: 'Xd = Xn OR imm', example: 'ORRI X1, X2, #1' },
  EORI: { group: 'Logic and shifts', meaning: 'Xd = Xn XOR imm', example: 'EORI X1, X2, #1' },
  LSL: { group: 'Logic and shifts', meaning: 'Xd = Xn shifted left by the amount, filling with 0s (multiplies by 2 per place)', example: 'LSL X1, X2, #3' },
  LSR: { group: 'Logic and shifts', meaning: 'Xd = Xn shifted right by the amount, filling with 0s (the sign is not kept)', example: 'LSR X1, X2, #3' },

  LDUR: { group: 'Load and store', meaning: 'Xt = the 8-byte doubleword at address Xn + offset', example: 'LDUR X1, [X2, #0]' },
  LDURB: { group: 'Load and store', meaning: 'Xt = the byte at Xn + offset, padded with 0s', example: 'LDURB X1, [X2, #0]' },
  LDURH: { group: 'Load and store', meaning: 'Xt = the 2-byte halfword at Xn + offset, padded with 0s', example: 'LDURH X1, [X2, #0]' },
  LDURSW: { group: 'Load and store', meaning: 'Xt = the 4-byte word at Xn + offset, sign-extended to 64 bits', example: 'LDURSW X1, [X2, #0]' },
  STUR: { group: 'Load and store', meaning: 'Store all 8 bytes of Xt at address Xn + offset', example: 'STUR X1, [X2, #0]' },
  STURB: { group: 'Load and store', meaning: 'Store the lowest byte of Xt at Xn + offset', example: 'STURB X1, [X2, #0]' },
  STURH: { group: 'Load and store', meaning: 'Store the lowest 2 bytes of Xt at Xn + offset', example: 'STURH X1, [X2, #0]' },
  STURW: { group: 'Load and store', meaning: 'Store the lowest 4 bytes of Xt at Xn + offset', example: 'STURW X1, [X2, #0]' },

  B: { group: 'Branches', meaning: 'Jump to the label', example: 'B Loop' },
  BL: { group: 'Branches', meaning: 'Call: put the address of the next instruction in X30, then jump to the label', example: 'BL Loop' },
  BR: { group: 'Branches', meaning: 'Jump to the address in Xn. BR X30 returns from a BL.', example: 'BR X30' },
  CBZ: { group: 'Branches', meaning: 'Jump to the label if Xt is 0', example: 'CBZ X1, Loop' },
  CBNZ: { group: 'Branches', meaning: 'Jump to the label if Xt is not 0', example: 'CBNZ X1, Loop' },
  'B.EQ': { group: 'Branches', meaning: 'Jump if equal (Z = 1)', example: 'B.EQ Loop', readsFlags: true },
  'B.NE': { group: 'Branches', meaning: 'Jump if not equal (Z = 0)', example: 'B.NE Loop', readsFlags: true },
  'B.HS': { group: 'Branches', meaning: 'Jump if unsigned higher or same, ≥ (C = 1)', example: 'B.HS Loop', readsFlags: true },
  'B.LO': { group: 'Branches', meaning: 'Jump if unsigned lower, < (C = 0)', example: 'B.LO Loop', readsFlags: true },
  'B.MI': { group: 'Branches', meaning: 'Jump if negative (N = 1)', example: 'B.MI Loop', readsFlags: true },
  'B.PL': { group: 'Branches', meaning: 'Jump if positive or zero (N = 0)', example: 'B.PL Loop', readsFlags: true },
  'B.VS': { group: 'Branches', meaning: 'Jump if overflow (V = 1)', example: 'B.VS Loop', readsFlags: true },
  'B.VC': { group: 'Branches', meaning: 'Jump if no overflow (V = 0)', example: 'B.VC Loop', readsFlags: true },
  'B.HI': { group: 'Branches', meaning: 'Jump if unsigned higher, > (C = 1 and Z = 0)', example: 'B.HI Loop', readsFlags: true },
  'B.LS': { group: 'Branches', meaning: 'Jump if unsigned lower or same, ≤ (C = 0 or Z = 1)', example: 'B.LS Loop', readsFlags: true },
  'B.GE': { group: 'Branches', meaning: 'Jump if signed greater or equal, ≥ (N = V)', example: 'B.GE Loop', readsFlags: true },
  'B.LT': { group: 'Branches', meaning: 'Jump if signed less than, < (N ≠ V)', example: 'B.LT Loop', readsFlags: true },
  'B.GT': { group: 'Branches', meaning: 'Jump if signed greater than, > (Z = 0 and N = V)', example: 'B.GT Loop', readsFlags: true },
  'B.LE': { group: 'Branches', meaning: 'Jump if signed less or equal, ≤ (Z = 1 or N ≠ V)', example: 'B.LE Loop', readsFlags: true },

  // ---- Full LEGv8 only: textbook instructions zyBooks doesn't have ----
  CMP: {
    group: 'Arithmetic', modes: FULL_ONLY, setsFlags: true, example: 'CMP X1, X2',
    meaning: 'Compare two registers: set the flags from Xn − Xm and throw the result away',
    alias: INSTEAD.CMP,
  },
  CMPI: {
    group: 'Arithmetic', modes: FULL_ONLY, setsFlags: true, example: 'CMPI X1, #5',
    meaning: 'Compare a register with a number: set the flags from Xn − imm and throw the result away',
    alias: INSTEAD.CMPI,
  },
  ANDS: {
    group: 'Logic and shifts', modes: FULL_ONLY, setsFlags: true, example: 'ANDS X1, X2, X3',
    meaning: 'Xd = Xn AND Xm, and set the flags (N and Z from the result; C and V cleared)',
  },
  ANDIS: {
    group: 'Logic and shifts', modes: FULL_ONLY, setsFlags: true, example: 'ANDIS X1, X2, #255',
    meaning: 'Xd = Xn AND imm, and set the flags (N and Z from the result; C and V cleared)',
  },
  UDIV: {
    group: 'Arithmetic', modes: FULL_ONLY, example: 'UDIV X1, X2, X3',
    meaning: 'Xd = Xn ÷ Xm, unsigned, rounded down. Dividing by zero stops the program with an error.',
  },
  SMULH: {
    group: 'Arithmetic', modes: FULL_ONLY, example: 'SMULH X1, X2, X3',
    meaning: 'Xd = the high 64 bits of the signed 128-bit product Xn × Xm (MUL gives the low 64 bits)',
  },
  UMULH: {
    group: 'Arithmetic', modes: FULL_ONLY, example: 'UMULH X1, X2, X3',
    meaning: 'Xd = the high 64 bits of the unsigned 128-bit product Xn × Xm',
  },
  MOV: {
    group: 'Move', modes: FULL_ONLY, example: 'MOV X1, X2',
    meaning: 'Copy a register into Xd, or put a number from -1024 to 65535 in it',
    alias: 'ADD Xd, Xn, XZR, or ADDI Xd, XZR, #imm (MOVZ for numbers above 4095)',
  },

  MOVZ: {
    group: 'Move',
    meaning: 'Xd = a 16-bit number placed at bit position 0, 16, 32 or 48, with all other bits 0',
    example: 'MOVZ X1, 1000, LSL 0',
    modeNote: {
      zybooks: 'zyBooks quirk: a negative number is sign-extended before shifting, so it sets all the bits above it too.',
      arm: 'Real ARM: only the low 16 bits of the number are used.',
    },
  },
  MOVK: {
    group: 'Move',
    meaning: 'Replace one 16-bit piece of Xd (at position 0, 16, 32 or 48) and keep the other bits',
    example: 'MOVK X1, 1000, LSL 16',
    modeNote: {
      zybooks: 'zyBooks quirk: a negative number is sign-extended, so it sets (instead of keeping) the bits above its piece.',
      arm: 'Real ARM: only the 16 bits of that piece change.',
    },
  },
};

/** Syntax for an instruction, built from the parser's operand format. */
const PSEUDO_SYNTAX: Readonly<Record<string, string>> = {
  CMP: 'CMP Xn, Xm',
  CMPI: 'CMPI Xn, #imm',
  MOV: 'MOV Xd, Xn  or  MOV Xd, #imm',
};

export function syntaxFor(op: string): string {
  if (Object.hasOwn(PSEUDO_SYNTAX, op)) return PSEUDO_SYNTAX[op]!;
  const format = (MNEMONIC_FORMAT[op] ?? EXTRA_MNEMONIC_FORMAT[op]) as Format;
  const shift = op === 'LSL' || op === 'LSR';
  switch (format) {
    case 'R':
      return `${op} Xd, Xn, Xm`;
    case 'I':
      return `${op} Xd, Xn, #${shift ? 'shift' : 'imm'}`;
    case 'D':
      return `${op} Xt, [Xn, #offset]`;
    case 'B':
      return `${op} label`;
    case 'CB':
      return `${op} Xt, label`;
    case 'BR':
      return `${op} Xn`;
    case 'IM':
      return `${op} Xd, imm, LSL shift`;
  }
}

/** Allowed numbers for an instruction's constant, or null when it has none. */
export function rangeFor(op: string, mode: Mode = 'zybooks'): string | null {
  if (op === 'CMPI') return `imm: ${FULL_RANGES.I.join(' to ')}`;
  if (Object.hasOwn(PSEUDO_SYNTAX, op)) return null;
  const format = (MNEMONIC_FORMAT[op] ?? EXTRA_MNEMONIC_FORMAT[op]) as Format;
  const full = mode === 'full';
  const span = (bits: number, widest?: readonly [number, number]) => {
    const [lo, hi] = widest ?? signedRange(bits);
    return `${lo} to ${hi}`;
  };
  switch (format) {
    case 'I':
      return op === 'LSL' || op === 'LSR'
        ? 'shift: 0 to 63'
        : `imm: ${span(IMMEDIATE_BITS.I, full ? FULL_RANGES.I : undefined)}`;
    case 'D':
      return `offset: ${span(IMMEDIATE_BITS.D)}`;
    case 'IM':
      return `imm: ${span(IMMEDIATE_BITS.IM, full ? FULL_RANGES.IM : undefined)}; shift: ${MOV_SHIFTS.join(', ')} (no #)`;
    default:
      return null;
  }
}

export interface HelpItem extends HelpEntry {
  op: string;
  syntax: string;
  range: string | null;
}

/** The instructions the simulator accepts in `mode`, in display order. */
export function instructionsFor(mode: Mode): HelpItem[] {
  const items = Object.entries(HELP)
    .filter(([, e]) => !e.modes || e.modes.includes(mode))
    .map(([op, e]) => ({ ...e, op, syntax: syntaxFor(op), range: rangeFor(op, mode) }));
  return HELP_GROUPS.flatMap((g) => items.filter((i) => i.group === g));
}

// ---------- the other sections ----------

export const MODE_INFO: Readonly<Record<Mode, { name: string; text: string }>> = {
  full: {
    name: 'Full LEGv8',
    text:
      'Real-ARM behavior (like ARM-accurate), plus textbook extras zyBooks doesn’t accept: CMP, CMPI and MOV; ' +
      'the names SP, FP, LR, IP0 and IP1; ANDS, ANDIS, UDIV, SMULH and UMULH; and larger numbers. Code that uses ' +
      'them won’t run in zyBooks; Convert to zyBooks rewrites what it can.',
  },
  zybooks: {
    name: 'zyBooks-compatible',
    text:
      'Behaves like the zyBooks simulator, including four behaviors that differ from real ARM hardware ' +
      '(marked below). Use this for zyBooks labs.',
  },
  arm: {
    name: 'ARM-accurate',
    text:
      'The same instructions, but the four behaviors marked below follow real ARM hardware. Results can ' +
      'differ from zyBooks in those cases.',
  },
};

export const RULES: readonly string[] = [
  'Instruction names and registers are UPPERCASE. There are no SP, FP or LR nicknames; write X28, X29, X30.',
  'A # is required before numbers in the "imm" and "offset" positions (ADDI X1, X2, #5). MOVZ and MOVK are the exception: no #.',
  'Load and store offsets are required, even for zero: LDUR X1, [X2, #0].',
  'Comments start with //. A label ends with a colon (Loop:) and may share a line with an instruction.',
  'Memory is addressed by byte, little-endian, from 0 to 2^62 − 1. A doubleword is 8 bytes; there are no alignment checks.',
  'Each instruction takes 4 bytes of instruction memory, starting at address 0. BL on instruction number i puts (i + 1) × 4 in X30.',
];

/** Syntax rules for a mode (the zyBooks ones, adjusted where Full LEGv8 differs). */
export function rulesFor(mode: Mode): readonly string[] {
  if (mode !== 'full') return RULES;
  return [
    'Instruction names and registers are UPPERCASE. SP, FP, LR, IP0 and IP1 are accepted as X28, X29, X30, X16 and X17.',
    'A # is required before numbers in the "imm" and "offset" positions. MOVZ and MOVK are the exception: no #. ADDI and the other immediate instructions take -1024 to 4095 (zyBooks stops at 1023).',
    ...RULES.slice(2),
  ];
}

export function registerNotesFor(mode: Mode): readonly string[] {
  return mode !== 'full'
    ? REGISTER_NOTES
    : [
        ...REGISTER_NOTES.slice(0, 1),
        'Nicknames: SP = X28, FP = X29, LR = X30, IP0 = X16, IP1 = X17. They are replaced by the X register when the code is read.',
        ...REGISTER_NOTES.slice(1),
      ];
}

export const REGISTER_NOTES: readonly string[] = [
  'X0 to X30 are 64-bit registers. XZR always reads as 0, and writes to it are ignored.',
  'The LEGv8 convention (not enforced by the simulator): X0–X7 arguments and results, X9–X15 temporaries, X19–X27 saved across calls, X28 stack pointer, X29 frame pointer, X30 link register (return address).',
  'The Registers panel lists only registers the program has used, like zyBooks.',
];

export interface Unsupported {
  what: string;
  instead: string;
  /** Full LEGv8 mode accepts it. */
  inFull?: boolean;
}

/** Things from the LEGv8 textbook that zyBooks (and so this simulator) doesn't accept. */
export const UNSUPPORTED: readonly Unsupported[] = [
  { what: 'CMP Xn, Xm', instead: INSTEAD.CMP!, inFull: true },
  { what: 'CMPI Xn, #imm', instead: INSTEAD.CMPI!, inFull: true },
  { what: 'MOV Xd, Xn  or  MOV Xd, #imm', instead: INSTEAD.MOV!, inFull: true },
  { what: 'ANDS', instead: INSTEAD.ANDS!, inFull: true },
  { what: 'ANDIS', instead: INSTEAD.ANDIS!, inFull: true },
  { what: 'UDIV', instead: INSTEAD.UDIV!, inFull: true },
  { what: 'SMULH, UMULH', instead: 'nothing equivalent', inFull: true },
  { what: 'ADDI and similar with a number above 1023', instead: 'MOVZ/MOVK, or several smaller steps', inFull: true },
  { what: 'LDXR, STXR', instead: 'LDUR and STUR (there is only one thread here)' },
  { what: 'Floating point (FADD, LDURS, …)', instead: 'nothing equivalent; there are no S or D registers' },
  { what: 'SP, FP, LR, IP0, IP1', instead: 'X28, X29, X30, X16, X17', inFull: true },
];

export const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['F5', 'Run / Continue'],
  ['F6', 'Pause'],
  ['F10', 'Step'],
  ['Ctrl+Z', 'Step back (while simulating)'],
  ['F9', 'Toggle breakpoint on the cursor line'],
  ['Ctrl+Enter', 'Enter / exit simulation'],
];
