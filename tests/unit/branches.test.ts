import { INFINITE_LOOP_MESSAGE, runProgram, type Storage } from '../../src/core/machine';

function run(source: string, registers: Record<string, string> = {}, maxSteps = 10_000) {
  return runProgram(source, { registers, memory: {} }, { maxSteps });
}

function storage(source: string, registers: Record<string, string> = {}): Storage {
  const r = run(source, registers);
  if (r.kind !== 'finished') throw new Error(`${r.kind}: ${r.message}`);
  return r.storage;
}

describe('CBZ / CBNZ', () => {
  const prog = (op: string) => `${op} X1, yes\nADDI X9, XZR, #1\nB end\nyes:\nADDI X9, XZR, #2\nend:`;

  it.each([
    ['CBZ', '0', '2'],
    ['CBZ', '5', '1'],
    ['CBNZ', '0', '1'],
    ['CBNZ', '-1', '2'],
  ])('%s with X1 = %s', (op, x1, x9) => {
    expect(storage(prog(op), { X1: x1 }).registers.X9).toBe(x9);
  });

  it('tests all 64 bits', () => {
    expect(storage(prog('CBZ'), { X1: String(2 ** 40) }).registers.X9).toBe('1');
  });

  it('counts down a loop', () => {
    const s = storage('Loop:\nCBZ X1, Done\nSUBI X1, X1, #1\nADDI X2, X2, #3\nB Loop\nDone:', { X1: '4' });
    expect(s.registers.X2).toBe('12');
  });
});

describe('BL / BR', () => {
  it('BL stores the byte address of the next instruction in X30 (P5)', () => {
    expect(storage('BL f\nB end\nf:\nADDI X9, XZR, #1\nend:').registers).toEqual({ X9: '1', X30: '4', XZR: '0' });
  });

  it('BR X30 returns to the caller', () => {
    const s = storage('ADDI X0, XZR, #1\nBL f\nADDI X0, X0, #10\nB end\nf:\nADDI X0, X0, #100\nBR X30\nend:');
    expect(s.registers.X0).toBe('111');
    expect(s.registers.X30).toBe('8');
  });

  it('runs the 8.1 sandbox default program', () => {
    const src =
      'ADDI X0, XZR, #3\nADDI X1, XZR, #4\n\nMUL X3, X0, X1\nSDIV X4, X3, X3\n\nBL add_proc\nB  exit\n\n' +
      'add_proc:\n   ADD X2, X0, X1\n   BR X30\n   \nexit:';
    expect(storage(src).registers).toEqual({
      X0: '3', X1: '4', X2: '7', X3: '12', X4: '1', X30: '20', XZR: '0',
    });
  });

  it('supports nested calls by saving X30 on a stack', () => {
    // X28 is the stack pointer (initialized to 8000 below; #8000 exceeds the immediate range).
    const src = [
      'BL outer',
      'B end',
      'outer:',
      'SUBI X28, X28, #8',
      'STUR X30, [X28, #0]',
      'BL inner',
      'ADDI X0, X0, #1',
      'LDUR X30, [X28, #0]',
      'ADDI X28, X28, #8',
      'BR X30',
      'inner:',
      'ADDI X0, X0, #10',
      'BR X30',
      'end:',
    ].join('\n');
    const s = storage(src, { X28: '8000' });
    expect(s.registers.X0).toBe('11');
    expect(s.registers.X28).toBe('8000');
    expect(s.memory).toEqual({ '7992': '4' }); // return address saved by `BL outer` at index 0

  });

  it('BR to an address past the program ends it', () => {
    expect(storage('BR X1\nADDI X9, XZR, #1', { X1: '400' }).registers.X9).toBeUndefined();
    expect(storage('BR X1\nADDI X9, XZR, #1', { X1: '-4' }).registers.X9).toBeUndefined();
  });

  it('BR to a computed address jumps to that instruction', () => {
    const s = storage('BR X1\nADDI X9, XZR, #1\nADDI X9, X9, #2', { X1: '8' });
    expect(s.registers.X9).toBe('2');
  });

  it('BR to a non-multiple of 4 is a runtime error', () => {
    expect(run('BR X1', { X1: '6' })).toEqual({
      kind: 'runtimeError',
      message: 'Error: BR X1. Instruction addresses should be word-aligned. Tried to access: 6',
    });
  });
});

describe('program end and step limit', () => {
  it('B to a trailing label ends the program', () => {
    expect(storage('B Exit\nADDI X9, XZR, #1\nExit:').registers.X9).toBeUndefined();
  });

  it('stops an infinite loop at the step limit', () => {
    expect(run('Loop:\nB Loop', {}, 1000)).toEqual({ kind: 'runtimeError', message: INFINITE_LOOP_MESSAGE });
  });
});
