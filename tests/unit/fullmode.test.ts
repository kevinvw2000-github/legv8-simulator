import { convertToZyBooks, findFullOnly, INSTEAD, parseHint } from '../../src/core/fullmode';
import { Machine, RuntimeError } from '../../src/core/machine';
import { ParseError, parseProgram } from '../../src/core/parser';
import type { Mode } from '../../src/core/state';

const parseError = (src: string, mode: Mode): string => {
  try {
    parseProgram(src, mode);
  } catch (e) {
    if (e instanceof ParseError) return e.display;
    throw e;
  }
  return 'no error';
};

const machine = (src: string, regs: Record<string, string> = {}, mode: Mode = 'full') =>
  new Machine(parseProgram(src, mode), { registers: regs, memory: {} }, mode);

const finish = (m: Machine) => {
  while (!m.done) m.step();
  return m;
};

const reg = (m: Machine, name: string) => m.state.registerView().find((r) => r.name === name)?.value;

describe('Full LEGv8 parsing', () => {
  it('is rejected in the other modes, exactly like any unknown instruction', () => {
    for (const mode of ['zybooks', 'arm'] as Mode[]) {
      for (const op of ['CMP X1, X2', 'CMPI X1, #5', 'MOV X1, X2', 'ANDS X1, X2, X3', 'ANDIS X1, X2, #5', 'UDIV X1, X2, X3', 'SMULH X1, X2, X3', 'UMULH X1, X2, X3']) {
        expect(parseError(op, mode), `${mode}: ${op}`).toBe(`Line 1: Unrecognized op code: ${op.split(' ')[0]}`);
      }
      expect(parseError('ADD SP, SP, XZR', mode)).toBe('Line 1: Instruction has an error.');
      expect(parseError('ADDI X1, X2, #2000', mode)).toBe('Line 1: 2000 is out of range. Valid range: -1024 to 1023');
      expect(parseError('MOVZ X1, 40000, LSL 0', mode)).toBe('Line 1: 40000 is out of range. Valid range: -32768 to 32767');
    }
  });

  it('accepts the extras and wider numbers', () => {
    expect(parseError('ANDS X1, X2, X3\nANDIS X1, X2, #4095\nUDIV X1, X2, X3\nSMULH X1, X2, X3\nUMULH X1, X2, X3', 'full')).toBe('no error');
    expect(parseError('ADDI X1, X2, #4095', 'full')).toBe('no error');
    expect(parseError('ADDI X1, X2, #4096', 'full')).toBe('Line 1: 4096 is out of range. Valid range: -1024 to 4095');
    expect(parseError('MOVZ X1, 65535, LSL 16', 'full')).toBe('no error');
    expect(parseError('MOVZ X1, 65536, LSL 16', 'full')).toBe('Line 1: 65536 is out of range. Valid range: -32768 to 65535');
    // Everything else still follows the zyBooks rules.
    expect(parseError('LDUR X1, [X2, #256]', 'full')).toBe('Line 1: 256 is out of range. Valid range: -256 to 255');
    expect(parseError('add X1, X2, X3', 'full')).toBe('Line 1: Unrecognized op code: add');
  });

  it('turns nicknames into registers, but only where a register belongs', () => {
    const p = parseProgram('ADDI SP, SP, #-16\nSTUR LR, [SP, #8]\nBL SP\nSP: BR LR', 'full');
    expect(p.instructions[0]).toMatchObject({ op: 'ADDI', rd: 'X28', rn: 'X28', imm: -16 });
    expect(p.instructions[1]).toMatchObject({ op: 'STUR', rt: 'X30', rn: 'X28' });
    expect(p.instructions[2]).toMatchObject({ op: 'BL', label: 'SP' }); // a label called SP
    expect(p.instructions[3]).toMatchObject({ op: 'BR', rn: 'X30' });
    const m = parseProgram('MOV FP, IP0\nMOV IP1, #1', 'full');
    expect(m.instructions[0]).toMatchObject({ op: 'ADD', rd: 'X29', rn: 'X16', rm: 'XZR' });
    expect(m.instructions[1]).toMatchObject({ op: 'ADDI', rd: 'X17' });
  });

  it('expands CMP, CMPI and MOV into the real instructions, keeping source lines', () => {
    const p = parseProgram('// c\nCMP X1, X2\nCMPI X1, #5\nMOV X1, X2\nMOV X1, #7\nMOV X1, #5000\nMOV X1, #-1024', 'full');
    expect(p.instructions).toEqual([
      { format: 'R', op: 'SUBS', line: 2, rd: 'XZR', rn: 'X1', rm: 'X2' },
      { format: 'I', op: 'SUBIS', line: 3, rd: 'XZR', rn: 'X1', imm: 5 },
      { format: 'R', op: 'ADD', line: 4, rd: 'X1', rn: 'X2', rm: 'XZR' },
      { format: 'I', op: 'ADDI', line: 5, rd: 'X1', rn: 'XZR', imm: 7 },
      { format: 'IM', op: 'MOVZ', line: 6, rd: 'X1', imm: 5000, shift: 0 },
      { format: 'I', op: 'ADDI', line: 7, rd: 'X1', rn: 'XZR', imm: -1024 },
    ]);
    expect(parseError('CMP X1', 'full')).toBe('Line 1: Instruction has an error.');
    expect(parseError('CMPI X1, 5', 'full')).toBe('Line 1: Instruction has an error.');
    expect(parseError('MOV X1, #70000', 'full')).toBe('Line 1: 70000 is out of range. Valid range: -1024 to 65535');
    expect(parseError('MOV X1, #-1025', 'full')).toBe('Line 1: -1025 is out of range. Valid range: -1024 to 65535');
  });
});

describe('Full LEGv8 behavior', () => {
  it('runs a textbook-style loop with CMP, MOV and nicknames', () => {
    const src = [
      'MOV X1, #5', 'MOV X2, #3', 'MOV X3, #0',
      'CMP X1, X2', 'B.GT Big', 'B End',
      'Big: ADDI X3, X3, #1',
      'End: SUBI SP, SP, #16', 'STUR X1, [SP, #8]', 'LDUR X4, [SP, #8]',
    ].join('\n');
    const m = finish(machine(src, { X28: '8000' }));
    expect(reg(m, 'X3')).toBe('1');
    expect(reg(m, 'X4')).toBe('5');
    expect(reg(m, 'X28')).toBe('7984');
  });

  it('ANDS and ANDIS set N and Z from the result and clear C and V', () => {
    const flags = (src: string, regs: Record<string, string>) => ({ ...finish(machine(src, regs)).state.flags });
    expect(flags('ANDS X3, X1, X2', { X1: '240', X2: '15' })).toEqual({ N: false, Z: true, C: false, V: false });
    expect(flags('ANDS X3, X1, X2', { X1: '-1', X2: '-2' })).toEqual({ N: true, Z: false, C: false, V: false });
    expect(flags('ANDIS X3, X1, #0', { X1: '5' })).toEqual({ N: false, Z: true, C: false, V: false });
    expect(reg(finish(machine('ANDS X3, X1, X2', { X1: '12', X2: '10' })), 'X3')).toBe('8');
    // The flags are real: B.EQ follows a zero result.
    const m = finish(machine('ANDS XZR, X1, X2\nB.EQ Zero\nADDI X5, XZR, #1\nB End\nZero: ADDI X5, XZR, #2\nEnd:', { X1: '4', X2: '3' }));
    expect(reg(m, 'X5')).toBe('2');
  });

  it('UDIV divides unsigned, and stops on division by zero', () => {
    expect(reg(finish(machine('UDIV X3, X1, X2', { X1: '100', X2: '7' })), 'X3')).toBe('14');
    // -1 is 2^64 − 1 as an unsigned number.
    expect(reg(finish(machine('UDIV X3, X1, X2', { X1: '-1', X2: '2' })), 'X3')).toBe('9223372036854775807');
    expect(() => finish(machine('UDIV X3, X1, X2', { X1: '1', X2: '0' }))).toThrow(RuntimeError);
  });

  it('SMULH and UMULH give the high 64 bits of the 128-bit product', () => {
    const high = (op: string, a: string, b: string) => reg(finish(machine(`${op} X3, X1, X2`, { X1: a, X2: b })), 'X3');
    expect(high('SMULH', '4611686018427387904', '8')).toBe('2'); // 2^62 * 8 = 2^65
    expect(high('SMULH', '-1', '1')).toBe('-1'); // product −1 is all ones
    expect(high('SMULH', '-4611686018427387904', '8')).toBe('-2');
    expect(high('UMULH', '-1', '2')).toBe('1'); // (2^64 − 1) * 2 = 2^65 − 2
    expect(high('UMULH', '5', '7')).toBe('0');
  });

  it('uses real ARM behavior where zyBooks has quirks', () => {
    expect(finish(machine('SUBS X0, X0, X1', { X0: '5', X1: '5' })).state.flags.Z).toBe(true);
    expect(reg(finish(machine('SDIV X3, X1, X2', { X1: '-7', X2: '2' })), 'X3')).toBe('-3');
    expect(reg(finish(machine('MOVZ X1, -1, LSL 0')), 'X1')).toBe('65535');
  });

  it('is undoable like everything else', () => {
    const m = machine('MOV X1, #5\nCMP X1, X1\nANDS X2, X1, X1');
    m.step();
    m.step();
    m.step();
    expect(m.state.flags).toEqual({ N: false, Z: false, C: false, V: false });
    m.stepBack();
    expect(m.state.flags.Z).toBe(true);
    m.stepBack();
    m.stepBack();
    expect(m.state.registerView()).toEqual([]);
  });
});

describe('convertToZyBooks', () => {
  it('rewrites nicknames and shorthands, keeping labels, spacing, comments and line numbers', () => {
    const src = ['Loop: CMP X1, X2   // compare', '  MOV LR, SP', 'ADDI SP, SP, #-16', 'B.EQ Loop', '', '// MOV SP, SP'].join('\n');
    const result = convertToZyBooks(src);
    expect(result.code).toBe(
      ['Loop: SUBS XZR, X1, X2   // compare', '  ADD X30, X28, XZR', 'ADDI X28, X28, #-16', 'B.EQ Loop', '', '// MOV SP, SP'].join('\n'),
    );
    expect(result.changed).toBe(3);
    expect(result.issues).toEqual([]);
  });

  it('picks the right instruction for MOV with a number', () => {
    const code = (n: string) => convertToZyBooks(`MOV X1, #${n}`);
    expect(code('-5').code).toBe('ADDI X1, XZR, #-5');
    expect(code('1023').code).toBe('ADDI X1, XZR, #1023');
    expect(code('5000').code).toBe('MOVZ X1, 5000, LSL 0');
    expect(code('70000')).toMatchObject({ code: 'MOV X1, #70000', changed: 0 });
    expect(code('70000').issues).toEqual([{ line: 1, reason: 'MOV #70000 is too large for zyBooks (its limit is 32767).' }]);
  });

  it('leaves what has no equivalent alone and says why', () => {
    const src = 'UDIV X1, X2, X3\nSMULH X1, X2, X3\nANDS X1, X2, X3\nADDI X1, X2, #2000\nMOVZ X1, 40000, LSL 0\nADD X1, X2, X3';
    const result = convertToZyBooks(src);
    expect(result.code).toBe(src);
    expect(result.changed).toBe(0);
    expect(result.issues).toEqual([
      { line: 1, reason: "UDIV isn't in zyBooks. Use SDIV (same result for values from 0 up to 2^32 − 1)." },
      { line: 2, reason: "SMULH isn't in zyBooks. There's nothing equivalent." },
      { line: 3, reason: "ANDS isn't in zyBooks. Use AND, then SUBIS XZR, Xd, #0 to set N and Z." },
      { line: 4, reason: "2000 is outside zyBooks' range (-1024 to 1023)." },
      { line: 5, reason: "40000 is outside zyBooks' range (-32768 to 32767)." },
    ]);
  });

  it('does not touch a label that is called SP, or a comment', () => {
    const src = 'B SP\nSP: ADD X1, X1, X1 // SP is X28';
    expect(convertToZyBooks(src)).toEqual({ code: src, changed: 0, issues: [] });
  });

  it('leaves lines with syntax errors for the parser to report', () => {
    const src = 'CMP X1\nADD X1 @ X2\nMOV X1, 5';
    expect(convertToZyBooks(src)).toEqual({ code: src, changed: 0, issues: [] });
  });

  it('produces code that zyBooks mode accepts and that computes the same thing', () => {
    const src = [
      'MOV SP, #4000', 'MOV X1, #6', 'MOV X2, X1', 'CMPI X1, #6', 'B.NE Skip',
      'SUBI SP, SP, #16', 'STUR X2, [SP, #0]', 'LDUR X3, [SP, #0]', 'MOV X4, #5000', 'Skip:',
    ].join('\n');
    const converted = convertToZyBooks(src);
    expect(converted.issues).toEqual([]);
    const a = finish(machine(src, {}, 'full'));
    const b = finish(machine(converted.code, {}, 'zybooks'));
    for (const r of ['X1', 'X2', 'X3', 'X4', 'X28']) expect(reg(b, r), r).toBe(reg(a, r));
    expect(findFullOnly(converted.code)).toEqual([]);
  });

  it('only suggests rewrites that zyBooks mode really accepts', () => {
    for (const ok of ['SUBS XZR, X1, X2', 'SUBIS XZR, X1, #5', 'ADD X1, X2, XZR', 'ADDI X1, XZR, #5', 'SDIV X1, X2, X3', 'AND X1, X2, X3\nSUBIS XZR, X1, #0']) {
      expect(parseError(ok, 'zybooks'), ok).toBe('no error');
    }
    expect(Object.keys(INSTEAD).sort()).toEqual(['ANDIS', 'ANDS', 'CMP', 'CMPI', 'MOV', 'UDIV']);
  });
});

describe('findFullOnly and parseHint', () => {
  it('lists everything zyBooks would reject', () => {
    const src = 'CMP X1, X2\nADD SP, SP, XZR // SP in a comment\nADDI X1, X2, #2000\nUDIV X1, X2, X3\nMOVK X1, 40000, LSL 16\nB SP\nADD X1, X2, X3';
    expect(findFullOnly(src).map((u) => `${u.line}:${u.what}:${u.kind}`)).toEqual([
      '1:CMP:instruction',
      '2:SP:nickname',
      '2:SP:nickname',
      '3:2000:range',
      '4:UDIV:instruction',
      '5:40000:range',
    ]);
  });

  it('adds a hint after a parse error in the modes that lack the construct', () => {
    const tail = ' (Or switch Compatibility to Full LEGv8.)';
    expect(parseHint('CMP X1, X2', 1, 'zybooks')).toBe(
      `\nCMP isn't available here (zyBooks doesn't have it). Write SUBS XZR, Xn, Xm instead.${tail}`,
    );
    expect(parseHint('ADD X1, X2, X3\nADD SP, X1, X2', 2, 'arm')).toBe(
      `\nSP isn't a register name here (zyBooks doesn't have it). Write X28.${tail}`,
    );
    expect(parseHint('SMULH X1, X2, X3', 1, 'zybooks')).toContain("There's nothing equivalent.");
    expect(parseHint('CMP X1, X2', 1, 'full')).toBe('');
    expect(parseHint('FOO X1', 1, 'zybooks')).toBe('');
    expect(parseHint('ADDI X1, X2, #2000', 1, 'zybooks')).toBe(''); // the error already states the range
    expect(parseHint('CMP X1, X2', null, 'zybooks')).toBe('');
    expect(parseHint('CMP X1, X2', 5, 'zybooks')).toBe('');
  });
});
