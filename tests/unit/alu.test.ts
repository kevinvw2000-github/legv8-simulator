import { runProgram, type RunOptions, type Storage } from '../../src/core/machine';

const empty: Storage = { registers: {}, memory: {} };

/** Run `source` and return the final registers (signed decimal strings). */
function regs(source: string, init: Record<string, string> = {}, options: RunOptions = {}) {
  const r = runProgram(source, { registers: init, memory: {} }, { maxSteps: 10_000, ...options });
  if (r.kind !== 'finished') throw new Error(`${r.kind}: ${r.message}`);
  return r.storage.registers;
}

/** Run, then report whether a conditional branch after `setup` was taken. */
function taken(setup: string, cond: string, init: Record<string, string> = {}, options: RunOptions = {}) {
  const src = `${setup}\n${cond} yes\nADDI X9, XZR, #1\nB end\nyes:\nADDI X9, XZR, #2\nend:`;
  return regs(src, init, options).X9 === '2';
}

const MAX = '9223372036854775807';
const MIN = '-9223372036854775808';

describe('R-format arithmetic and logic', () => {
  it('ADD/SUB with 64-bit wraparound', () => {
    expect(regs('ADD X3, X1, X2', { X1: MAX, X2: '1' }).X3).toBe(MIN);
    expect(regs('SUB X3, X1, X2', { X1: MIN, X2: '1' }).X3).toBe(MAX);
    expect(regs('SUB X3, X1, X2', { X1: '3', X2: '10' }).X3).toBe('-7');
  });

  it('AND/ORR/EOR', () => {
    const r = regs('AND X3, X1, X2\nORR X4, X1, X2\nEOR X5, X1, X2', { X1: '12', X2: '10' });
    expect([r.X3, r.X4, r.X5]).toEqual(['8', '14', '6']);
  });

  it('MUL keeps the low 64 bits', () => {
    expect(regs('MUL X3, X1, X2', { X1: '-3', X2: '7' }).X3).toBe('-21');
    expect(regs('MUL X3, X1, X2', { X1: '4294967296', X2: '4294967296' }).X3).toBe('0');
  });

  it('SDIV truncates toward zero for small non-negative values', () => {
    expect(regs('SDIV X3, X1, X2', { X1: '7', X2: '2' }).X3).toBe('3');
  });

  it('SDIV zyBooks quirk drops bits 32–39 (P1)', () => {
    expect(regs('SDIV X3, X1, X2', { X1: '-7', X2: '2' }).X3).toBe('-547608330243');
    // Divisor 2^32 reads as 0.
    const r = runProgram('SDIV X3, X1, X2', { registers: { X1: '5', X2: '4294967296' }, memory: {} });
    expect(r).toEqual({ kind: 'runtimeError', message: 'Error: SDIV X3, X1, X2. division by zero' });
  });

  it('SDIV in ARM mode is correct', () => {
    const arm = { mode: 'arm' } as const;
    expect(regs('SDIV X3, X1, X2', { X1: '-7', X2: '2' }, arm).X3).toBe('-3');
    expect(regs('SDIV X3, X1, X2', { X1: MIN, X2: '-1' }, arm).X3).toBe(MIN);
  });

  it('SDIV by zero is a runtime error (P6)', () => {
    expect(runProgram('SDIV X1, X2, XZR', empty)).toEqual({
      kind: 'runtimeError',
      message: 'Error: SDIV X1, X2, XZR. division by zero',
    });
  });
});

describe('I-format', () => {
  it('ADDI/SUBI with negative immediates', () => {
    const r = regs('ADDI X1, XZR, #-5\nSUBI X2, XZR, #7');
    expect([r.X1, r.X2]).toEqual(['-5', '-7']);
  });

  it('ANDI/ORRI/EORI sign-extend the immediate', () => {
    const r = regs('ANDI X2, X1, #-1\nORRI X3, XZR, #-1\nEORI X4, X1, #15', { X1: '255' });
    expect([r.X2, r.X3, r.X4]).toEqual(['255', '-1', '240']);
  });

  it('LSL/LSR (logical) and shift masking to 6 bits', () => {
    const r = regs('LSL X2, X1, #3\nLSR X3, X4, #60\nLSL X5, X1, #64\nLSL X6, X1, #-1', {
      X1: '1',
      X4: '-1',
    });
    expect([r.X2, r.X3, r.X5, r.X6]).toEqual(['8', '15', '1', MIN]);
  });
});

describe('MOVZ / MOVK', () => {
  it('builds a 64-bit constant', () => {
    const r = regs('MOVZ X1, 4660, LSL 48\nMOVK X1, 22136, LSL 0');
    expect(r.X1).toBe((0x1234n << 48n | 0x5678n).toString());
  });

  it('MOVK replaces only its field', () => {
    expect(regs('MOVK X1, 0, LSL 16', { X1: '-1' }).X1).toBe((-(0xffffn << 16n) - 1n).toString());
  });

  it('negative immediates are sign-extended in zyBooks mode', () => {
    expect(regs('MOVZ X1, -1, LSL 16').X1).toBe('-65536');
    expect(regs('MOVK X1, -1, LSL 0').X1).toBe('-1');
  });

  it('ARM mode keeps only 16 bits', () => {
    const arm = { mode: 'arm' } as const;
    expect(regs('MOVZ X1, -1, LSL 16', {}, arm).X1).toBe('4294901760');
    expect(regs('MOVK X1, -1, LSL 0', {}, arm).X1).toBe('65535');
  });
});

describe('XZR', () => {
  it('ignores writes and reads as zero', () => {
    const r = regs('ADDI XZR, XZR, #5\nADD X1, XZR, XZR');
    expect(r).toEqual({ X1: '0', XZR: '0' });
  });
});

describe('register panel', () => {
  it('lists only accessed registers, in index order', () => {
    expect(Object.keys(regs('ADDI X30, XZR, #1\nADD X9, X2, X30'))).toEqual(['X2', 'X9', 'X30', 'XZR']);
  });
});

describe('flags and conditional branches', () => {
  // [description, setup, init, expectations: cond → taken]
  const cases: Array<[string, string, Record<string, string>, Record<string, boolean>]> = [
    ['equal', 'SUBS XZR, X1, X2', { X1: '5', X2: '5' },
      { 'B.EQ': true, 'B.NE': false, 'B.GE': true, 'B.LE': true, 'B.GT': false, 'B.LT': false, 'B.HS': true, 'B.LO': false, 'B.HI': false, 'B.LS': true }],
    ['signed less', 'SUBS XZR, X1, X2', { X1: '-1', X2: '1' },
      { 'B.LT': true, 'B.GE': false, 'B.MI': true, 'B.PL': false, 'B.HS': true, 'B.HI': true, 'B.LO': false }],
    ['unsigned less', 'SUBS XZR, X1, X2', { X1: '1', X2: '2' },
      { 'B.LO': true, 'B.HS': false, 'B.LS': true, 'B.HI': false, 'B.LT': true }],
    ['signed overflow on add', 'ADDS XZR, X1, X2', { X1: MAX, X2: '1' },
      { 'B.VS': true, 'B.VC': false, 'B.MI': true, 'B.HS': false }],
    ['unsigned carry on add', 'ADDS XZR, X1, X2', { X1: '-1', X2: '1' },
      { 'B.HS': true, 'B.EQ': true, 'B.VS': false }],
    ['overflow on sub', 'SUBS XZR, X1, X2', { X1: MIN, X2: '1' },
      { 'B.VS': true, 'B.GE': false, 'B.LT': true, 'B.PL': true }],
    ['ADDIS negative immediate carries', 'ADDIS XZR, X1, #-1', { X1: '5' },
      { 'B.HS': true, 'B.GT': true }],
  ];

  for (const [name, setup, init, expectations] of cases) {
    for (const [cond, expected] of Object.entries(expectations)) {
      it(`${name}: ${cond} ${expected ? 'taken' : 'not taken'}`, () => {
        expect(taken(setup, cond, init)).toBe(expected);
        expect(taken(setup, cond, init, { mode: 'arm' })).toBe(expected);
      });
    }
  }

  it('flags start cleared', () => {
    expect(taken('ADD X1, X1, X1', 'B.EQ')).toBe(false);
    expect(taken('ADD X1, X1, X1', 'B.LO')).toBe(true);
  });

  it('only S-instructions change flags', () => {
    expect(taken('SUBS XZR, X1, X1\nSUB X2, X1, X3', 'B.EQ', { X1: '4', X3: '1' })).toBe(true);
  });

  it('zyBooks computes flags after writing Rd (P2)', () => {
    const init = { X0: '5', X1: '5' };
    expect(taken('SUBS X0, X0, X1', 'B.EQ', init)).toBe(false);
    expect(taken('SUBS X0, X0, X1', 'B.EQ', init, { mode: 'arm' })).toBe(true);
    expect(taken('ADDIS X1, X1, #1', 'B.EQ', { X1: '-1' })).toBe(false); // flags of 0 + 1
  });

  it('zyBooks SUBIS carry quirk (P3)', () => {
    expect(taken('SUBIS XZR, X1, #1', 'B.HS', { X1: '-1' })).toBe(false);
    expect(taken('SUBIS XZR, X1, #1', 'B.HS', { X1: '-1' }, { mode: 'arm' })).toBe(true);
    expect(taken('SUBIS XZR, X1, #3', 'B.HS', { X1: '10' })).toBe(true);
    expect(taken('SUBIS XZR, X1, #10', 'B.HS', { X1: '3' })).toBe(false);
    expect(taken('SUBIS XZR, X1, #5', 'B.HS', { X1: '5' })).toBe(true);
  });
});
