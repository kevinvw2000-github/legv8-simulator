import { HELP, instructionsFor, rangeFor, registerNotesFor, rulesFor, syntaxFor, UNSUPPORTED } from '../../src/core/help';
import { EXTRA_MNEMONIC_FORMAT, MNEMONIC_FORMAT, PSEUDO_OPS } from '../../src/core/isa';
import { Machine } from '../../src/core/machine';
import { parseProgram } from '../../src/core/parser';
import type { Mode } from '../../src/core/state';

describe('Help content', () => {
  it('covers exactly the instructions the parser accepts', () => {
    // zyBooks' 47, plus what only Full LEGv8 mode accepts.
    const accepted = [...Object.keys(MNEMONIC_FORMAT), ...Object.keys(EXTRA_MNEMONIC_FORMAT), ...PSEUDO_OPS];
    expect(Object.keys(HELP).sort()).toEqual(accepted.sort());
    expect(Object.keys(MNEMONIC_FORMAT)).toHaveLength(47);
    expect(Object.keys(HELP)).toHaveLength(55);
  });

  it('has an example for every instruction that the parser accepts', () => {
    for (const [op, entry] of Object.entries(HELP)) {
      expect(entry.example.split(/[ ,]/)[0], op).toBe(op);
      const mode = entry.modes ? 'full' : 'zybooks';
      expect(() => parseProgram(`Loop:\n${entry.example}`, mode), entry.example).not.toThrow();
      expect(() => parseProgram(`Loop:\n${entry.example}`, 'full'), entry.example).not.toThrow();
      // Full-only entries are exactly the ones the other modes reject.
      if (entry.modes) expect(() => parseProgram(`Loop:\n${entry.example}`, 'zybooks'), entry.example).toThrow();
    }
  });

  it('builds syntax and ranges from the parser tables', () => {
    expect(syntaxFor('ADD')).toBe('ADD Xd, Xn, Xm');
    expect(syntaxFor('ADDI')).toBe('ADDI Xd, Xn, #imm');
    expect(syntaxFor('LSL')).toBe('LSL Xd, Xn, #shift');
    expect(syntaxFor('LDUR')).toBe('LDUR Xt, [Xn, #offset]');
    expect(syntaxFor('B.GE')).toBe('B.GE label');
    expect(syntaxFor('CBZ')).toBe('CBZ Xt, label');
    expect(syntaxFor('BR')).toBe('BR Xn');
    expect(syntaxFor('MOVZ')).toBe('MOVZ Xd, imm, LSL shift');
    expect(rangeFor('ADDI')).toBe('imm: -1024 to 1023');
    expect(rangeFor('LSR')).toBe('shift: 0 to 63');
    expect(rangeFor('STURB')).toBe('offset: -256 to 255');
    expect(rangeFor('MOVK')).toBe('imm: -32768 to 32767; shift: 0, 16, 32, 48 (no #)');
    expect(rangeFor('ADD')).toBeNull();
  });

  it('keeps the documented ranges consistent with what the parser enforces', () => {
    expect(() => parseProgram('ADDI X1, X2, #1023')).not.toThrow();
    expect(() => parseProgram('ADDI X1, X2, #1024')).toThrow();
    expect(() => parseProgram('LDUR X1, [X2, #255]')).not.toThrow();
    expect(() => parseProgram('LDUR X1, [X2, #256]')).toThrow();
  });

  it('lists mode differences for exactly the four quirks, with a note for each mode', () => {
    const withNotes = Object.entries(HELP).filter(([, e]) => e.modeNote);
    expect(withNotes.map(([op]) => op).sort()).toEqual(['ADDIS', 'ADDS', 'MOVK', 'MOVZ', 'SDIV', 'SUBIS', 'SUBS']);
    for (const [, e] of withNotes) {
      expect(Object.keys(e.modeNote!).sort()).toEqual(['arm', 'zybooks']);
    }
  });

  it('returns every instruction in grouped order for each mode', () => {
    for (const mode of ['zybooks', 'arm'] as Mode[]) {
      const items = instructionsFor(mode);
      expect(items).toHaveLength(47);
      expect(items[0]!.group).toBe('Arithmetic');
      expect(items[items.length - 1]!.op).toBe('MOVK');
    }
    const full = instructionsFor('full');
    expect(full).toHaveLength(55);
    expect(full.filter((i) => i.modes).map((i) => i.op).sort()).toEqual(
      ['ANDIS', 'ANDS', 'CMP', 'CMPI', 'MOV', 'SMULH', 'UDIV', 'UMULH'],
    );
  });

  it('explains each shorthand with the real instruction it becomes', () => {
    expect(HELP.CMP!.alias).toBe('SUBS XZR, Xn, Xm');
    expect(HELP.CMPI!.alias).toBe('SUBIS XZR, Xn, #imm');
    expect(HELP.MOV!.alias).toContain('ADD Xd, Xn, XZR');
    // What the alias says is what the parser really produces.
    const op = (src: string) => parseProgram(src, 'full').instructions[0]!.op;
    expect([op('CMP X1, X2'), op('CMPI X1, #5'), op('MOV X1, X2')]).toEqual(['SUBS', 'SUBIS', 'ADD']);
  });

  it('shows the wider ranges and the shorthand syntax in Full LEGv8 mode', () => {
    expect(rangeFor('ADDI', 'full')).toBe('imm: -1024 to 4095');
    expect(rangeFor('MOVK', 'full')).toBe('imm: -32768 to 65535; shift: 0, 16, 32, 48 (no #)');
    expect(rangeFor('LDUR', 'full')).toBe('offset: -256 to 255');
    expect(rangeFor('CMPI', 'full')).toBe('imm: -1024 to 4095');
    expect(syntaxFor('CMP')).toBe('CMP Xn, Xm');
    expect(syntaxFor('ANDS')).toBe('ANDS Xd, Xn, Xm');
    expect(syntaxFor('ANDIS')).toBe('ANDIS Xd, Xn, #imm');
    expect(rulesFor('full')[0]).toContain('SP, FP, LR');
    expect(registerNotesFor('full').join(' ')).toContain('SP = X28');
  });

  it('marks what Full LEGv8 accepts in the Not-supported table', () => {
    const full = UNSUPPORTED.filter((u) => u.inFull).map((u) => u.what.split(/[ ,]/)[0]);
    expect(full).toEqual(expect.arrayContaining(['CMP', 'CMPI', 'MOV', 'ANDS', 'ANDIS', 'UDIV', 'SMULH', 'SP']));
    expect(UNSUPPORTED.filter((u) => !u.inFull).map((u) => u.what)).toEqual([
      'LDXR, STXR',
      'Floating point (FADD, LDURS, …)',
    ]);
  });

  it('suggests only rewrites made of instructions the simulator accepts', () => {
    const accepted = /^(SUBS|SUBIS|ADD|ADDI|AND|ANDI|SDIV|LDUR|STUR)\b/;
    const rewritten = UNSUPPORTED.filter((u) => accepted.test(u.instead));
    expect(rewritten.length).toBeGreaterThan(3);
    for (const u of ['SUBS XZR, X1, X2', 'SUBIS XZR, X1, #5', 'ADD X1, X2, XZR', 'ADDI X1, XZR, #5']) {
      expect(() => parseProgram(u), u).not.toThrow();
    }
    for (const u of UNSUPPORTED.filter((x) => /^(CMP|CMPI|MOV|UDIV)\b/.test(x.what))) {
      expect(() => parseProgram(u.what.replace(/Xd|Xn|Xm|imm/g, (t) => (t === 'imm' ? '1' : 'X1')))).toThrow();
    }
  });
});

describe('Help text matches the simulator', () => {
  const run = (mode: Mode, src: string, regs: Record<string, string>) => {
    const m = new Machine(parseProgram(src), { registers: regs, memory: {} }, mode);
    while (!m.done) m.step();
    return m.state;
  };
  const reg = (mode: Mode, src: string, regs: Record<string, string>, name: string) =>
    run(mode, src, regs).registerView().find((r) => r.name === name)?.value;

  it('SDIV: −7 ÷ 2', () => {
    const regs = { X1: '-7', X2: '2' };
    expect(reg('zybooks', 'SDIV X3, X1, X2', regs, 'X3')).toBe('-547608330243');
    expect(reg('arm', 'SDIV X3, X1, X2', regs, 'X3')).toBe('-3');
    expect(HELP.SDIV!.modeNote!.zybooks).toContain('−547608330243');
    expect(HELP.SDIV!.modeNote!.arm).toContain('−3');
  });

  it('SUBS with Xd as a source: flags use the new value in zyBooks mode only', () => {
    const regs = { X0: '5', X1: '5' };
    expect(run('zybooks', 'SUBS X0, X0, X1', regs).flags.Z).toBe(false);
    expect(run('arm', 'SUBS X0, X0, X1', regs).flags.Z).toBe(true);
  });

  it('MOVZ with a negative number: sign-extended only in zyBooks mode', () => {
    expect(reg('zybooks', 'MOVZ X1, -1, LSL 0', {}, 'X1')).toBe('-1');
    expect(reg('arm', 'MOVZ X1, -1, LSL 0', {}, 'X1')).toBe('65535');
  });

  it('SUBIS: a negative immediate always sets C in zyBooks mode', () => {
    expect(run('zybooks', 'SUBIS XZR, X1, #-1', { X1: '0' }).flags.C).toBe(true);
    expect(run('arm', 'SUBIS XZR, X1, #-1', { X1: '0' }).flags.C).toBe(false);
  });
});
