import { callStackView, stackView } from '../../src/core/calls';
import { Machine, type Storage } from '../../src/core/machine';
import { parseProgram } from '../../src/core/parser';

const machine = (src: string, initial: Storage = { registers: {}, memory: {} }) =>
  new Machine(parseProgram(src), initial);

// Recursive pow2(n) = 2 * pow2(n - 1), pow2(0) = 1, saving X30 and X0 on the stack.
const POW2 = [
  'ADDI X0, XZR, #3', //      1
  'BL pow2', //               2
  'B done', //                3
  'pow2:', //                 4
  'SUBI X28, X28, #16', //    5
  'STUR X30, [X28, #8]', //   6
  'STUR X0, [X28, #0]', //    7
  'CBZ X0, base', //          8
  'SUBI X0, X0, #1', //       9
  'BL pow2', //              10
  'LSL X1, X1, #1', //       11
  'B ret', //                12
  'base:', //                13
  'ADDI X1, XZR, #1', //     14
  'ret:', //                 15
  'LDUR X0, [X28, #0]', //   16
  'LDUR X30, [X28, #8]', //  17
  'ADDI X28, X28, #16', //   18
  'BR X30', //               19
  'done:', //                20
].join('\n');
const SP0 = { registers: { X28: '8000' }, memory: {} };

/** Step until `stop` returns true (or the program ends). */
function stepUntil(m: Machine, stop: (m: Machine) => boolean, limit = 1000) {
  for (let i = 0; i < limit && !m.done && !stop(m); i++) m.step();
}

describe('call stack', () => {
  it('tracks recursive calls and their return points', () => {
    const m = machine(POW2, SP0);
    stepUntil(m, (m) => m.program.instructions[m.state.pc]?.line === 14); // base case
    expect(callStackView(m.state, m.program)).toEqual([
      { label: 'pow2', depth: 4, callLine: 10, returnsTo: 'line 11 (0x24)' },
      { label: 'pow2', depth: 3, callLine: 10, returnsTo: 'line 11 (0x24)' },
      { label: 'pow2', depth: 2, callLine: 10, returnsTo: 'line 11 (0x24)' },
      { label: 'pow2', depth: 1, callLine: 2, returnsTo: 'line 3 (0x8)' },
    ]);
    expect(m.state.callWarning).toBeNull();
  });

  it('is empty again after every call returns', () => {
    const m = machine(POW2, SP0);
    stepUntil(m, () => false);
    expect(m.done).toBe(true);
    expect(m.storage().registers.X1).toBe('8');
    expect(m.state.callStack).toEqual([]);
    expect(m.state.callWarning).toBeNull();
  });

  it('warns when BR X30 goes somewhere other than the expected return point', () => {
    // a calls b without saving X30, so a's BR X30 returns into itself.
    const src = ['BL a', 'B end', 'a:', 'BL b', 'BR X30', 'b:', 'BR X30', 'end:'].join('\n');
    const m = machine(src);
    for (let i = 0; i < 4; i++) m.step();
    expect(callStackView(m.state, m.program).map((f) => f.label)).toEqual(['a']);
    expect(m.state.callWarning).toBe(
      'BR X30 went to line 5 (0xC), but a should return to line 2 (0x4). X30 may have been ' +
        'overwritten by a nested BL without being saved and restored.',
    );
  });

  it('ignores BR through other registers that is not a return (e.g. a jump table)', () => {
    const src = ['BL f', 'B end', 'f:', 'ADDI X9, XZR, #20', 'BR X9', 'ADDI X1, XZR, #1', 'BR X30', 'end:'].join('\n');
    const m = machine(src);
    for (let i = 0; i < 3; i++) m.step(); // BL, ADDI, BR X9
    expect(m.state.callStack).toHaveLength(1);
    expect(m.state.callWarning).toBeNull();
    stepUntil(m, () => false);
    expect(m.state.callStack).toEqual([]);
  });

  it('notes calls that never returned when an outer return address is used', () => {
    const src = ['BL a', 'B end', 'a:', 'ADD X19, X30, XZR', 'BL b', 'B end', 'b:', 'BR X19', 'end:'].join('\n');
    const m = machine(src);
    stepUntil(m, () => false);
    expect(m.state.callStack).toEqual([]);
    expect(m.state.callWarning).toBe('Returned from a, but 1 call made inside it (b) never returned.');
  });
});

describe('stack view', () => {
  it('shows saved registers from SP up to the top, labelled by owning call', () => {
    const m = machine(POW2, SP0);
    stepUntil(m, (m) => m.program.instructions[m.state.pc]?.line === 14);
    const v = stackView(m.state, m.program);
    expect(v.sp).toBe(8000n - 64n);
    expect(v.top).toBe(8000n);
    expect(v.rows.map((r) => r.offset)).toEqual([0n, 8n, 16n, 24n, 32n, 40n, 48n, 56n]);
    expect(v.rows.map((r) => r.note)).toEqual([
      'saved X0 (line 7)', 'saved X30 (line 6) → line 11',
      'saved X0 (line 7)', 'saved X30 (line 6) → line 11',
      'saved X0 (line 7)', 'saved X30 (line 6) → line 11',
      'saved X0 (line 7)', 'saved X30 (line 6) → line 3',
    ]);
    // Saved n values: 0 (innermost), 1, 2, 3; saved return addresses 0x24 x3, then 0x8.
    expect(v.rows.map((r) => r.value)).toEqual([0n, 36n, 1n, 36n, 2n, 36n, 3n, 8n]);
    // Each call's 16-byte frame, innermost (call 4) at SP.
    expect(v.rows.map((r) => r.owner?.depth)).toEqual([4, 4, 3, 3, 2, 2, 1, 1]);
    expect(v.rows.every((r) => r.owner?.label === 'pow2')).toBe(true);
  });

  it('does not mark anything as accessed', () => {
    const m = machine('SUBI X28, X28, #16', SP0);
    m.step();
    const before = m.storage();
    const v = stackView(m.state, m.program);
    expect(v.rows).toHaveLength(2);
    expect(v.rows.every((r) => !r.present)).toBe(true);
    expect(m.storage()).toEqual(before);
  });

  it('is empty when X28 was never set', () => {
    const m = machine('ADDI X1, XZR, #1');
    m.step();
    expect(stackView(m.state, m.program).rows).toEqual([]);
  });

  it('forgets a saved-register note when the slot is partly overwritten', () => {
    const m = machine('STUR X1, [X28, #-8]\nSTURB X2, [X28, #-5]', SP0);
    m.step();
    m.state.regs[28] = 8000n - 8n; // look at the slot from SP
    expect(stackView(m.state, m.program).rows[0]!.note).toBe('saved X1 (line 1)');
    m.state.regs[28] = 8000n;
    m.step();
    expect(m.state.storeOrigins.size).toBe(0);
  });

  it('limits rows and reports how many are hidden', () => {
    const m = machine('SUBI X28, X28, #800', SP0);
    m.step();
    const v = stackView(m.state, m.program, 64);
    expect(v.rows).toHaveLength(64);
    expect(v.hidden).toBe(36);
  });
});

describe('step back restores call tracking', () => {
  it('undoes a call and a return', () => {
    const m = machine(POW2, SP0);
    m.step(); // ADDI
    m.step(); // BL
    expect(m.state.callStack).toHaveLength(1);
    m.stepBack();
    expect(m.state.callStack).toHaveLength(0);
  });
});
