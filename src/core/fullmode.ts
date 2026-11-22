// Helpers for moving between Full LEGv8 mode and zyBooks: finding what zyBooks would reject,
// rewriting source so it runs there, and hints for people who typed a textbook-only construct
// in a mode that doesn't accept it.

import {
  EXTRA_MNEMONIC_FORMAT,
  FORMAT_TOKENS,
  IMMEDIATE_BITS,
  MNEMONIC_FORMAT,
  NICKNAMES,
  PSEUDO_OPS,
  signedRange,
} from './isa';
import { ParseError, tokenizeLine, type Token } from './parser';
import type { Mode } from './state';

/** What to write in zyBooks instead of each construct it doesn't have. */
export const INSTEAD: Readonly<Record<string, string>> = {
  CMP: 'SUBS XZR, Xn, Xm',
  CMPI: 'SUBIS XZR, Xn, #imm',
  MOV: 'ADD Xd, Xn, XZR (or ADDI Xd, XZR, #imm)',
  ANDS: 'AND, then SUBIS XZR, Xd, #0 to set N and Z',
  ANDIS: 'ANDI, then SUBIS XZR, Xd, #0 to set N and Z',
  UDIV: 'SDIV (same result for values from 0 up to 2^32 − 1)',
};

const ZY_I = signedRange(IMMEDIATE_BITS.I);
const ZY_IM = signedRange(IMMEDIATE_BITS.IM);

type UseKind = 'instruction' | 'nickname' | 'range';

interface Use {
  /** The instruction, nickname or number involved. */
  what: string;
  kind: UseKind;
  /** The nickname token (for rewriting). */
  token?: Token;
}

interface LineScan {
  op: string;
  opToken: Token;
  operands: Token[];
  uses: Use[];
}

const stripComment = (text: string): [code: string, comment: string] => {
  const c = text.indexOf('//');
  return c < 0 ? [text, ''] : [text.slice(0, c), text.slice(c)];
};

const lines = (source: string): string[] => source.split(/\r\n|\r|\n/);

/** What in one line (without its comment) zyBooks wouldn't accept. Null when there's no instruction to look at. */
function scanLine(code: string, lineNo: number): LineScan | null {
  let tokens: Token[];
  try {
    tokens = tokenizeLine(code, lineNo);
  } catch (e) {
    if (e instanceof ParseError) return null; // syntax errors are reported by the parser
    throw e;
  }
  const opIdx = tokens.findIndex((t) => t.kind === 'word');
  if (opIdx < 0) return null;
  const opToken = tokens[opIdx]!;
  const op = opToken.text;
  const operands = tokens.slice(opIdx + 1);
  const uses: Use[] = [];

  const pseudo = PSEUDO_OPS.includes(op);
  const extra = Object.hasOwn(EXTRA_MNEMONIC_FORMAT, op);
  if (pseudo || extra) uses.push({ what: op, kind: 'instruction' });

  const format = Object.hasOwn(MNEMONIC_FORMAT, op)
    ? MNEMONIC_FORMAT[op]
    : extra
      ? EXTRA_MNEMONIC_FORMAT[op]
      : undefined;
  const expected = format ? FORMAT_TOKENS[format] : undefined;
  operands.forEach((t, i) => {
    if (t.kind === 'word' && Object.hasOwn(NICKNAMES, t.text) && (pseudo || expected?.[i] === 'register')) {
      uses.push({ what: t.text, kind: 'nickname', token: t });
    }
  });

  // Numbers that fit the textbook's range but not zyBooks'.
  if (!extra && !pseudo) {
    const n = format === 'I' ? operands[5] : format === 'IM' ? operands[2] : undefined;
    const [lo, hi] = format === 'I' ? ZY_I : ZY_IM;
    if (n?.kind === 'number' && (Number(n.text) > hi || Number(n.text) < lo)) uses.push({ what: n.text, kind: 'range' });
  }
  return { op, opToken, operands, uses };
}

export interface FullOnlyUse {
  /** 1-based source line. */
  line: number;
  /** "CMP", "SP", or the number that is too large. */
  what: string;
  kind: UseKind;
}

/** Everything in `source` that zyBooks would reject but Full LEGv8 accepts. */
export function findFullOnly(source: string): FullOnlyUse[] {
  return lines(source).flatMap((text, i) => {
    const scan = scanLine(stripComment(text)[0], i + 1);
    return (scan?.uses ?? []).map((u) => ({ line: i + 1, what: u.what, kind: u.kind }));
  });
}

export interface ConversionIssue {
  line: number;
  reason: string;
}

export interface Conversion {
  /** The rewritten source (lines that couldn't be converted are left as they were). */
  code: string;
  /** How many lines were rewritten. */
  changed: number;
  /** Lines that still won't work in zyBooks. */
  issues: ConversionIssue[];
}

/**
 * Rewrite Full LEGv8 source so it runs in zyBooks: nicknames become X registers, CMP/CMPI/MOV become
 * the instructions they stand for. Anything with no equivalent is left alone and reported. Lines
 * keep their numbers, so breakpoints and error messages still line up.
 */
export function convertToZyBooks(source: string): Conversion {
  const issues: ConversionIssue[] = [];
  let changed = 0;
  const out = lines(source).map((text, i) => {
    const lineNo = i + 1;
    const [code, comment] = stripComment(text);
    const scan = scanLine(code, lineNo);
    if (!scan) return text;

    const canon = (t: Token): string => (t.kind === 'word' && Object.hasOwn(NICKNAMES, t.text) ? NICKNAMES[t.text]! : t.text);
    const kindOf = (t: Token): string => (t.kind === 'word' && Object.hasOwn(NICKNAMES, t.text) ? 'register' : t.kind);
    const kinds = scan.operands.map(kindOf).join(' ');
    const prefix = code.slice(0, scan.opToken.index);
    const trail = /\s*$/.exec(code)![0];
    const ops = scan.operands.map(canon);
    let newCode = code;
    let rewritten: string | null = null;

    switch (scan.op) {
      case 'CMP':
        if (kinds === 'register comma register') rewritten = `SUBS XZR, ${ops[0]}, ${ops[2]}`;
        break;
      case 'CMPI':
        if (kinds === 'register comma hash number') rewritten = `SUBIS XZR, ${ops[0]}, #${ops[3]}`;
        break;
      case 'MOV':
        if (kinds === 'register comma register') rewritten = `ADD ${ops[0]}, ${ops[2]}, XZR`;
        else if (kinds === 'register comma hash number') {
          const n = Number(ops[3]);
          if (n >= ZY_I[0] && n <= ZY_I[1]) rewritten = `ADDI ${ops[0]}, XZR, #${n}`;
          else if (n >= 0 && n <= ZY_IM[1]) rewritten = `MOVZ ${ops[0]}, ${n}, LSL 0`;
          else issues.push({ line: lineNo, reason: `MOV #${n} is too large for zyBooks (its limit is ${ZY_IM[1]}).` });
        }
        break;
      default: {
        if (Object.hasOwn(EXTRA_MNEMONIC_FORMAT, scan.op)) {
          const instead = INSTEAD[scan.op];
          issues.push({
            line: lineNo,
            reason: `${scan.op} isn't in zyBooks. ${instead ? `Use ${instead}.` : "There's nothing equivalent."}`,
          });
        } else {
          // A regular instruction: only nicknames need replacing, and the spacing stays as typed.
          for (const u of [...scan.uses].reverse()) {
            if (u.kind !== 'nickname' || !u.token) continue;
            newCode = newCode.slice(0, u.token.index) + NICKNAMES[u.what] + newCode.slice(u.token.index + u.what.length);
          }
        }
      }
    }
    if (rewritten !== null) newCode = prefix + rewritten + trail;

    // Whatever is left may still use numbers zyBooks can't take.
    for (const u of scanLine(newCode, lineNo)?.uses ?? []) {
      if (u.kind === 'range') {
        const limit = scan.op === 'MOVZ' || scan.op === 'MOVK' ? ZY_IM : ZY_I;
        issues.push({ line: lineNo, reason: `${u.what} is outside zyBooks' range (${limit[0]} to ${limit[1]}).` });
      }
    }
    if (newCode !== code) changed++;
    return newCode + comment;
  });
  return { code: out.join('\n'), changed, issues };
}

/**
 * A line to add after a parse error, when the failing line used something only Full LEGv8
 * accepts. Empty in Full LEGv8 mode or when the line has no such construct.
 */
export function parseHint(source: string, line: number | null, mode: Mode): string {
  if (mode === 'full' || line === null) return '';
  const text = lines(source)[line - 1];
  if (text === undefined) return '';
  const use = scanLine(stripComment(text)[0], line)?.uses.find((u) => u.kind !== 'range');
  if (!use) return '';
  const tail = ' (Or switch Compatibility to Full LEGv8.)';
  if (use.kind === 'nickname') {
    return `\n${use.what} isn't a register name here (zyBooks doesn't have it). Write ${NICKNAMES[use.what]}.${tail}`;
  }
  const instead = INSTEAD[use.what];
  return `\n${use.what} isn't available here (zyBooks doesn't have it). ${instead ? `Write ${instead} instead.` : "There's nothing equivalent."}${tail}`;
}
