import { instructionToString } from '../../src/core/isa';
import { ParseError, parseProgram, tokenizeLine } from '../../src/core/parser';

/** Display text of the ParseError thrown for `source`. */
function errorOf(source: string): string {
  try {
    parseProgram(source);
  } catch (e) {
    if (e instanceof ParseError) return e.display;
    throw e;
  }
  throw new Error('expected a ParseError');
}

const kinds = (text: string) => tokenizeLine(text, 1).map((t) => `${t.kind}:${t.text}`);

describe('tokenizer', () => {
  it('splits a D-format line and drops spaces/comments', () => {
    expect(kinds('LDUR X1, [X2, #-8] // load')).toEqual([
      'word:LDUR', 'register:X1', 'comma:,', 'openBracket:[', 'register:X2', 'comma:,',
      'hash:#', 'number:-8', 'closeBracket:]',
    ]);
  });

  it('recognizes labels, including a label before an instruction', () => {
    expect(kinds('L1: ADD X1, X2, X3')[0]).toBe('label:L1:');
    expect(kinds('add_proc:')).toEqual(['label:add_proc:']);
  });

  it('treats only uppercase X registers and XZR as registers', () => {
    expect(kinds('XZR X30 X99')).toEqual(['register:XZR', 'register:X30', 'register:X99']);
    expect(kinds('x1')).toEqual(['word:x1']);
    expect(kinds('SP LR')).toEqual(['word:SP', 'word:LR']);
  });

  it('splits X100 into register X10 and number 0', () => {
    expect(kinds('X100')).toEqual(['register:X10', 'number:0']);
  });

  it('keeps dots in mnemonics', () => {
    expect(kinds('B.GT Loop')).toEqual(['word:B.GT', 'word:Loop']);
  });

  it('does not treat # as a comment', () => {
    expect(kinds('#5')).toEqual(['hash:#', 'number:5']);
  });

  it('reports unrecognized syntax with the rest of the line', () => {
    expect(() => tokenizeLine('ADD X1, X2 @ X3', 4)).toThrow('Unrecognized syntax near: @ X3');
  });
});

describe('parser: valid programs', () => {
  it('parses every format', () => {
    const p = parseProgram(
      [
        'ADD X1, X2, X3',
        'ADDI X1, X2, #-1024',
        'STUR X1, [X2, #255]',
        'B end',
        'CBZ X1, end',
        'BR X30',
        'MOVK X1, -32768, LSL 48',
        'end:',
      ].join('\n'),
    );
    expect(p.instructions.map(instructionToString)).toEqual([
      'ADD X1, X2, X3',
      'ADDI X1, X2, #-1024',
      'STUR X1, [X2, #255]',
      'B end',
      'CBZ X1 end',
      'BR X30',
      'MOVK X1, -32768, LSL 48',
    ]);
  });

  it('binds labels to the next instruction and trailing labels past the end', () => {
    const p = parseProgram('A:\nB: ADD X1, X2, X3\n\nC:\nSUB X1, X1, X1\nExit:');
    expect(Object.fromEntries(p.labels)).toEqual({ A: 0, B: 0, C: 1, Exit: 2 });
  });

  it('records source line numbers', () => {
    const p = parseProgram('// header\n\nADD X1, X2, X3');
    expect(p.instructions[0]?.line).toBe(3);
  });

  it('accepts operands without spaces', () => {
    expect(parseProgram('LDUR X1,[X2,#8]').instructions).toHaveLength(1);
  });

  it('parses the 8.1 sandbox default program', () => {
    const src =
      'ADDI X0, XZR, #3\nADDI X1, XZR, #4\n\nMUL X3, X0, X1\nSDIV X4, X3, X3\n\nBL add_proc\nB  exit\n\n' +
      'add_proc:\n   ADD X2, X0, X1\n   BR X30\n   \nexit:';
    const p = parseProgram(src);
    expect(p.instructions).toHaveLength(8);
    expect(p.labels.get('exit')).toBe(8);
  });
});

describe('parser: error messages', () => {
  it.each([
    ['empty program', '// nothing\n\n', 'Enter assembly to simulate.'],
    ['unknown mnemonic', 'FOO X1, X2, X3', 'Line 1: Unrecognized op code: FOO'],
    ['lowercase mnemonic', 'add X1, X2, X3', 'Line 1: Unrecognized op code: add'],
    ['missing operand', 'ADD X1, X2', 'Line 1: Instruction has an error.'],
    ['missing #', 'ADDI X1, X2, 5', 'Line 1: Instruction has an error.'],
    ['D-format without offset', 'LDUR X1, [X2]', 'Line 1: Instruction has an error.'],
    ['MOVZ with #', 'MOVZ X1, #5, LSL 0', 'Line 1: Instruction has an error.'],
    ['CB without comma', 'CBZ X1 end\nend:', 'Line 1: Instruction has an error.'],
    ['X100 splits', 'ADD X100, X1, X2', 'Line 1: Instruction has an error.'],
    ['line starts with register', 'X1, X2', 'Line 1: Unexpected text: X1'],
    ['invalid register X31', 'ADD X31, X1, X2', 'Line 1: X31 is not a valid register name'],
    ['invalid register X01', 'ADD X1, X01, X2', 'Line 1: X01 is not a valid register name'],
    ['I imm too large', 'ADDI X1, X2, #1024', 'Line 1: 1024 is out of range. Valid range: -1024 to 1023'],
    ['I imm too small', 'SUBI X1, X2, #-1025', 'Line 1: -1025 is out of range. Valid range: -1024 to 1023'],
    ['shift amount range', 'LSL X1, X2, #2000', 'Line 1: 2000 is out of range. Valid range: -1024 to 1023'],
    ['D offset range', 'STUR X1, [X2, #256]', 'Line 1: 256 is out of range. Valid range: -256 to 255'],
    ['MOVZ range (P7)', 'MOVZ X1, 32768, LSL 0', 'Line 1: 32768 is out of range. Valid range: -32768 to 32767'],
    ['MOVZ needs LSL', 'MOVZ X1, 5, ASR 0', "Line 1: ASR must be 'LSL'"],
    ['MOVZ shift value', 'MOVK X1, 5, LSL 8', 'Line 1: 8 must be 0, 16, 32, or 48.'],
    ['undefined label', 'B nowhere', 'Line 1: Label is undefined: nowhere'],
    ['duplicate label', 'L:\nADD X1, X2, X3\nL:', 'Line 3: Same label as on line 1. A label should be defined only once.'],
  ])('%s', (_name, source, expected) => {
    expect(errorOf(source)).toBe(expected);
  });

  it('reports a later syntax error before an earlier instruction error', () => {
    expect(errorOf('FOO X1\nADD X1, X2, X3\nADD @')).toBe('Line 3: Unrecognized syntax near: @');
  });

  it('checks undefined labels only after all lines parse', () => {
    expect(errorOf('B nowhere\nFOO X1')).toBe('Line 2: Unrecognized op code: FOO');
  });

  it('reports the first undefined label in program order', () => {
    expect(errorOf('B second\nB first')).toBe('Line 1: Label is undefined: second');
  });
});
