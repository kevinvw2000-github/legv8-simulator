// Lexer + parser/assembler for LEGv8 source text.
// Error messages and their ordering match the zyBooks simulator (docs/COMPATIBILITY.md).

import {
  FORMAT_TOKENS,
  IMMEDIATE_BITS,
  MNEMONIC_FORMAT,
  MOV_SHIFTS,
  REGISTER_NAMES,
  signedRange,
  type Instruction,
  type TokenKind,
} from './isa';

export interface Token {
  kind: TokenKind;
  text: string;
}

export interface Program {
  instructions: Instruction[];
  /** Label name → index of the instruction it refers to (may equal instructions.length). */
  labels: Map<string, number>;
  /** Label name → 1-based source line where it was defined. */
  labelLines: Map<string, number>;
}

export class ParseError extends Error {
  constructor(
    message: string,
    /** 1-based source line, or null for whole-program errors. */
    readonly line: number | null,
  ) {
    super(message);
    this.name = 'ParseError';
  }

  /** Text shown to the user, e.g. "Line 3: Instruction has an error." */
  get display(): string {
    return this.line === null ? this.message : `Line ${this.line}: ${this.message}`;
  }
}

type Rule = { kind: TokenKind | 'space' | 'comment'; re: RegExp };

// Tried in this order at the current position of each line.
const RULES: readonly Rule[] = [
  { kind: 'comment', re: /^\/\/.*$/ },
  { kind: 'label', re: /^\w+:/ },
  { kind: 'space', re: /^\s+/ },
  { kind: 'comma', re: /^,/ },
  { kind: 'register', re: /^X(\d{1,2}|ZR)/ },
  { kind: 'openBracket', re: /^\[/ },
  { kind: 'closeBracket', re: /^\]/ },
  { kind: 'hash', re: /^#/ },
  { kind: 'number', re: /^-?\d+/ },
  { kind: 'word', re: /^(\w|\.)+/ },
];

/** Tokenize one line; spaces and comments are dropped. */
export function tokenizeLine(text: string, line: number): Token[] {
  const tokens: Token[] = [];
  let rest = text;
  while (rest.length > 0) {
    let matched = false;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (!m) continue;
      if (rule.kind !== 'space' && rule.kind !== 'comment') {
        tokens.push({ kind: rule.kind, text: m[0] });
      }
      rest = rest.slice(m[0].length);
      matched = true;
      break;
    }
    if (!matched) throw new ParseError(`Unrecognized syntax near: ${rest}`, line);
  }
  return tokens;
}

function checkRegister(name: string): void {
  if (!REGISTER_NAMES.includes(name)) throw new Error(`${name} is not a valid register name`);
}

function checkSigned(value: number, bits: number): void {
  const [lo, hi] = signedRange(bits);
  if (value < lo || value > hi) throw new Error(`${value} is out of range. Valid range: ${lo} to ${hi}`);
}

/** Build and validate one instruction from its mnemonic and operand tokens. */
function buildInstruction(op: string, operands: Token[], line: number): Instruction {
  const format = Object.hasOwn(MNEMONIC_FORMAT, op) ? MNEMONIC_FORMAT[op] : undefined;
  if (!format) throw new ParseError(`Unrecognized op code: ${op}`, line);

  const expected = FORMAT_TOKENS[format];
  const kinds = operands.map((t) => t.kind);
  if (kinds.length !== expected.length || kinds.some((k, i) => k !== expected[i])) {
    throw new ParseError('Instruction has an error.', line);
  }

  // Operand values in order, punctuation removed.
  const v = operands
    .filter((t) => t.kind === 'register' || t.kind === 'number' || t.kind === 'word')
    .map((t) => t.text);
  const at = (i: number): string => v[i] as string;
  const num = (i: number): number => Number(at(i));

  try {
    switch (format) {
      case 'R':
        [0, 1, 2].forEach((i) => checkRegister(at(i)));
        return { format, op, line, rd: at(0), rn: at(1), rm: at(2) };
      case 'I':
        checkRegister(at(0));
        checkRegister(at(1));
        checkSigned(num(2), IMMEDIATE_BITS.I);
        return { format, op, line, rd: at(0), rn: at(1), imm: num(2) };
      case 'D':
        checkRegister(at(0));
        checkRegister(at(1));
        checkSigned(num(2), IMMEDIATE_BITS.D);
        return { format, op, line, rt: at(0), rn: at(1), offset: num(2) };
      case 'B':
        return { format, op, line, label: at(0) };
      case 'CB':
        checkRegister(at(0));
        return { format, op, line, rt: at(0), label: at(1) };
      case 'BR':
        checkRegister(at(0));
        return { format, op, line, rn: at(0) };
      case 'IM': {
        checkRegister(at(0));
        checkSigned(num(1), IMMEDIATE_BITS.IM);
        if (at(2) !== 'LSL') throw new Error(`${at(2)} must be 'LSL'`);
        if (!MOV_SHIFTS.includes(num(3))) throw new Error(`${num(3)} must be 0, 16, 32, or 48.`);
        return { format, op, line, rd: at(0), imm: num(1), shift: num(3) };
      }
    }
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError((e as Error).message, line);
  }
}

/**
 * Parse a whole program. Throws ParseError on the first problem.
 * Like zyBooks, all lines are tokenized before any line is parsed, so a syntax
 * error on a later line is reported ahead of an instruction error on an earlier one.
 */
export function parseProgram(source: string): Program {
  const lines = source.split(/\r\n|\r|\n/).map((text, i) => tokenizeLine(text, i + 1));

  const instructions: Instruction[] = [];
  const labels = new Map<string, number>();
  const labelLines = new Map<string, number>();
  const pending: string[] = [];

  lines.forEach((tokens, i) => {
    const line = i + 1;
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t] as Token;
      if (tok.kind === 'label') {
        const name = tok.text.slice(0, -1);
        const prev = labelLines.get(name);
        if (prev !== undefined) {
          throw new ParseError(`Same label as on line ${prev}. A label should be defined only once.`, line);
        }
        labelLines.set(name, line);
        pending.push(name);
      } else if (tok.kind === 'word') {
        instructions.push(buildInstruction(tok.text, tokens.slice(t + 1), line));
        for (const name of pending.splice(0)) labels.set(name, instructions.length - 1);
        break;
      } else {
        throw new ParseError(`Unexpected text: ${tok.text}`, line);
      }
    }
  });
  // Labels after the last instruction point one past the end (program exit).
  for (const name of pending) labels.set(name, instructions.length);

  for (const ins of instructions) {
    if ((ins.format === 'B' || ins.format === 'CB') && !labels.has(ins.label)) {
      throw new ParseError(`Label is undefined: ${ins.label}`, ins.line);
    }
  }

  if (instructions.length === 0) throw new ParseError('Enter assembly to simulate.', null);

  return { instructions, labels, labelLines };
}
