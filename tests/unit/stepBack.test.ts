import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Machine, RuntimeError, type Storage } from '../../src/core/machine';
import { parseProgram } from '../../src/core/parser';
import type { MachineState } from '../../src/core/state';

/** Everything the UI can show about the machine, as plain data. */
function snapshot(st: MachineState) {
  return {
    registers: st.registerView(),
    memory: st.memoryView(),
    flags: { ...st.flags },
    pc: st.pc,
    steps: st.steps,
  };
}

function machine(source: string, initial: Storage = { registers: {}, memory: {} }, mode?: 'zybooks' | 'arm') {
  return new Machine(parseProgram(source), initial, mode);
}

/** Step to the end (or `limit`), then step back to the start, checking every state on the way. */
function roundTrip(m: Machine, limit = 2000) {
  const states = [snapshot(m.state)];
  let error: string | null = null;
  while (!m.done && states.length <= limit) {
    try {
      m.step();
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      error = e.message;
      break;
    }
    states.push(snapshot(m.state));
  }
  if (error) {
    // The failed step is undoable: back to the state before it.
    expect(m.stepBack()).toBe(true);
    expect(snapshot(m.state)).toEqual(states[states.length - 1]);
  }
  for (let i = states.length - 2; i >= 0; i--) {
    expect(m.stepBack()).toBe(true);
    expect(snapshot(m.state)).toEqual(states[i]);
  }
  expect(m.stepBack()).toBe(false);
  return states.length - 1;
}

describe('Step back', () => {
  it('restores registers, flags, PC, steps and highlighting', () => {
    const m = machine('ADDI X1, XZR, #5\nSUBIS X2, X1, #5\nADDI X3, X1, #1');
    m.step();
    m.step();
    expect(m.state.flags.Z).toBe(true);
    expect(m.state.changedRegs).toEqual(new Set([2]));
    m.stepBack();
    expect(m.state.flags.Z).toBe(false);
    expect(m.state.pc).toBe(1);
    expect(m.state.steps).toBe(1);
    // Highlighting shows what the step before changed again.
    expect(m.state.changedRegs).toEqual(new Set([1]));
    expect(m.state.registerView().map((r) => r.name)).toEqual(['X1', 'XZR']);
  });

  it('removes memory and registers that only appeared because of the undone step', () => {
    const m = machine('LDUR X1, [XZR, #200]');
    m.step();
    expect(m.storage().memory).toEqual({ '200': '0' });
    m.stepBack();
    expect(m.storage()).toEqual({ registers: {}, memory: {} });
  });

  it('restores overwritten memory bytes', () => {
    const m = machine('STURB X1, [X2, #3]\nSTUR X1, [X2, #0]', {
      registers: { X1: '-1', X2: '4000' },
      memory: { '4000': '1234605616436508552' }, // 0x1122334455667788
    });
    roundTrip(m);
    expect(m.storage().memory).toEqual({ '4000': '1234605616436508552' });
  });

  it('undoes a step that failed with a runtime error', () => {
    // The load creates entries for the valid bytes before reaching the invalid one.
    const max = ((1n << 62n) - 4n).toString();
    const m = machine('ADDI X1, XZR, #1\nLDUR X3, [X2, #0]', { registers: { X2: max }, memory: {} });
    m.step();
    expect(() => m.step()).toThrow(RuntimeError);
    expect(Object.keys(m.storage().memory)).not.toHaveLength(0);
    m.stepBack();
    expect(m.storage().memory).toEqual({});
    expect(m.state.pc).toBe(1);
    expect(m.done).toBe(false);
  });

  it('round-trips BL/BR, branches and a loop', () => {
    const src = [
      'ADDI X19, XZR, #4',
      'ADDI X20, XZR, #1000',
      'Loop:',
      'CBZ X19, Done',
      'BL Store',
      'SUBI X19, X19, #1',
      'B Loop',
      'Store:',
      'STUR X19, [X20, #0]',
      'ADDI X20, X20, #8',
      'BR X30',
      'Done:',
    ].join('\n');
    expect(roundTrip(machine(src))).toBeGreaterThan(20);
  });

  it('works the same in ARM-accurate mode', () => {
    roundTrip(machine('SUBI X1, XZR, #7\nADDI X2, XZR, #2\nSDIV X3, X1, X2\nADDS X1, X1, X2', undefined, 'arm'));
  });

  it('keeps only the most recent historyLimit steps (trimmed in batches)', () => {
    const m = machine('Loop:\nADDI X1, X1, #1\nB Loop');
    m.historyLimit = 10;
    for (let i = 0; i < 2000; i++) m.step();
    expect(m.historyLength).toBeGreaterThanOrEqual(10);
    expect(m.historyLength).toBeLessThanOrEqual(1010);
    const kept = m.historyLength;
    while (m.stepBack());
    expect(m.state.steps).toBe(2000 - kept);
  });

  it('records nothing when historyLimit is 0', () => {
    const m = machine('ADDI X1, XZR, #1');
    m.historyLimit = 0;
    m.step();
    expect(m.stepBack()).toBe(false);
  });
});

describe('Step back round-trips every conformance program', () => {
  const dir = join(__dirname, '../golden');
  const cases = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { cases: any[] }).cases)
    .filter((c) => !c.expected.parseError && (c.source !== undefined || c.sourceFile !== undefined));

  for (const c of cases) {
    it(c.name, () => {
      let source: string;
      try {
        source = c.source ?? readFileSync(join(dir, c.sourceFile), 'utf8');
      } catch {
        return; // local-only source not present
      }
      roundTrip(machine(source, c.initial), 500);
    });
  }
});
