import { findHoverTarget, memoryInfo, registerInfo, type HoverTarget } from '../../src/core/hover';
import { Machine } from '../../src/core/machine';
import { parseProgram } from '../../src/core/parser';

const at = (text: string, token: string, nth = 0) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = text.indexOf(token, i + 1);
  return i;
};

describe('findHoverTarget', () => {
  it('finds registers', () => {
    const t = 'ADD X1, X28, XZR';
    expect(findHoverTarget(t, at(t, 'X1'))).toEqual({ kind: 'register', name: 'X1', from: 4, to: 6 });
    expect(findHoverTarget(t, at(t, 'X28') + 2)).toMatchObject({ kind: 'register', name: 'X28' });
    expect(findHoverTarget(t, at(t, 'XZR'))).toMatchObject({ name: 'XZR' });
  });

  it('ignores everything else', () => {
    const t = 'ADD X1, X31, X2 // X9';
    expect(findHoverTarget(t, 0)).toBeNull(); // opcode
    expect(findHoverTarget(t, at(t, 'X31'))).toBeNull(); // not a register
    expect(findHoverTarget(t, at(t, 'X9'))).toBeNull(); // in a comment
    expect(findHoverTarget(t, 999)).toBeNull();
    expect(findHoverTarget(t, -1)).toBeNull();
    expect(findHoverTarget('Loop:', 2)).toBeNull();
  });

  it('finds the [Xn, #off] part of loads and stores, but the register inside is a register', () => {
    const t = 'Loop: LDURSW X1, [X2, #-8]';
    const mem: HoverTarget = { kind: 'memory', op: 'LDURSW', base: 'X2', offset: -8, from: at(t, '['), to: t.length };
    expect(findHoverTarget(t, at(t, '['))).toEqual(mem);
    expect(findHoverTarget(t, at(t, '#-8'))).toEqual(mem);
    expect(findHoverTarget(t, t.length - 1)).toEqual(mem);
    expect(findHoverTarget(t, at(t, 'X2'))).toMatchObject({ kind: 'register', name: 'X2' });
    expect(findHoverTarget('ADD X1, [X2, #1]', at('ADD X1, [X2, #1]', '#1'))).toBeNull();
    expect(findHoverTarget('STURB X1, [XZR, #3]', at('STURB X1, [XZR, #3]', '#3'))).toMatchObject({ op: 'STURB', base: 'XZR', offset: 3 });
  });
});

describe('inspection reads without marking anything accessed', () => {
  const machine = (src: string, regs: Record<string, string> = {}, mem: Record<string, string> = {}) =>
    new Machine(parseProgram(src), { registers: regs, memory: mem });

  it('describes registers', () => {
    const m = machine('BL f\nB end\nf:\nADDI X5, XZR, #7\nBR X30\nend:', { X28: '8000' });
    const info = (name: string) => registerInfo(m.state, m.program, name);
    expect(info('X28')).toMatchObject({ value: 8000n, role: 'stack pointer (SP)' });
    expect(info('XZR')).toEqual({ name: 'XZR', value: 0n, used: true, role: 'always 0' });
    expect(info('X30')).toMatchObject({ used: false, role: 'link register' });
    m.step(); // BL
    expect(info('X30')).toMatchObject({ value: 4n, used: true, role: 'link register — returns to line 2 (0x4)' });
    m.step(); // ADDI
    expect(info('X5')).toMatchObject({ value: 7n, used: true, role: null });
    expect(info('X9')).toMatchObject({ value: 0n, used: false });
    expect(m.state.registerView().map((r) => r.name)).toEqual(['X5', 'X28', 'X30', 'XZR']); // X9 is not listed
  });

  it('describes memory operands', () => {
    const m = machine('LDURSW X1, [X2, #8]', { X2: '4000' }, { '4008': '-2' });
    const target = { kind: 'memory', op: 'LDURSW', base: 'X2', offset: 8, from: 0, to: 0 } as const;
    // -2 is stored as 8 bytes; the 4-byte load sees 0xFFFFFFFE and sign-extends it.
    expect(memoryInfo(m.state, target)).toMatchObject({ address: 4008n, size: 4, valid: true, present: true, value: (1n << 64n) - 2n });
    expect(memoryInfo(m.state, { ...target, offset: 16 })).toMatchObject({ address: 4016n, present: false, value: 0n });
    expect(memoryInfo(m.state, { ...target, op: 'STUR', offset: 0 })).toMatchObject({ store: true, size: 8, address: 4000n });
    // Looking never creates memory entries.
    expect(m.state.memoryView().map((r) => r.address)).toEqual(['4008']);
  });

  it('flags invalid addresses, including wrap-around below zero', () => {
    const m = machine('LDUR X1, [X2, #-8]', { X2: '0' });
    const info = memoryInfo(m.state, { kind: 'memory', op: 'LDUR', base: 'X2', offset: -8, from: 0, to: 0 });
    expect(info).toMatchObject({ address: (1n << 64n) - 8n, valid: false, present: false });
    // The last 4 bytes of the address space are valid for a word but not for a doubleword.
    const top = (1n << 62n) - 4n;
    const m2 = machine('LDUR X1, [X2, #0]', { X2: top.toString() });
    const base = { kind: 'memory', base: 'X2', offset: 0, from: 0, to: 0 } as const;
    expect(memoryInfo(m2.state, { ...base, op: 'LDURSW' }).valid).toBe(true);
    expect(memoryInfo(m2.state, { ...base, op: 'LDUR' }).valid).toBe(false);
  });
});
