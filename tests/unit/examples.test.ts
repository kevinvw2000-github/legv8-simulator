import { EXAMPLE_GROUPS, EXAMPLES, type Example } from '../../src/core/examples';
import { checkExpected, parseExpected, type ExpectedEntry } from '../../src/core/expected';
import { convertToZyBooks, findFullOnly } from '../../src/core/fullmode';
import { Machine, RuntimeError } from '../../src/core/machine';
import { parseProgram } from '../../src/core/parser';
import { sanitizeWatches } from '../../src/core/share';

const initial = (ex: Example, extra: Record<string, string> = {}) => ({
  registers: { ...Object.fromEntries(ex.registers.map((r) => [r.key, r.value])), ...extra },
  memory: Object.fromEntries(ex.memory.map((m) => [m.key, m.value])),
});

const build = (ex: Example, extra: Record<string, string> = {}) =>
  new Machine(parseProgram(ex.code, ex.mode), initial(ex, extra), ex.mode);

const entries = (kind: 'registers' | 'memory', text: string): ExpectedEntry[] => {
  const p = parseExpected(kind, text);
  if ('error' in p) throw new Error(`${kind}: ${p.error}`);
  return p.entries;
};

const results = (ex: Example, m: Machine) =>
  checkExpected(m.state, entries('registers', ex.expected.registers), entries('memory', ex.expected.memory));

const finish = (m: Machine, limit = 5000) => {
  let n = 0;
  while (!m.done && n++ < limit) m.step();
  return m;
};

const byId = (id: string) => EXAMPLES.find((e) => e.id === id)!;
const reg = (m: Machine, name: string) => m.state.registerView().find((r) => r.name === name)?.value;

describe('example data', () => {
  it('has unique ids and titles, in known groups, with every group used', () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    expect(new Set(EXAMPLES.map((e) => e.title)).size).toBe(EXAMPLES.length);
    for (const e of EXAMPLES) expect(EXAMPLE_GROUPS, e.id).toContain(e.group);
    for (const g of EXAMPLE_GROUPS) expect(EXAMPLES.some((e) => e.group === g), g).toBe(true);
    expect(EXAMPLES).toHaveLength(12);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s: parses in its own mode and its values are valid', (_id, ex) => {
    expect(() => build(ex)).not.toThrow();
    expect(sanitizeWatches(ex.watches)).toEqual(ex.watches);
    expect(() => entries('registers', ex.expected.registers)).not.toThrow();
    expect(() => entries('memory', ex.expected.memory)).not.toThrow();
    expect(ex.description.length).toBeGreaterThan(20);
    const codeLines = ex.code.split('\n');
    for (const line of ex.breakpoints ?? []) {
      const text = codeLines[line - 1]!.trim();
      expect(text !== '' && !text.startsWith('//') && !text.endsWith(':'), `${ex.id} line ${line}: ${text}`).toBe(true);
    }
  });

  it('every example starts by saying it is an example', () => {
    for (const ex of EXAMPLES) {
      expect(ex.code.split('\n')[0], ex.id).toBe(`// EXAMPLE: ${ex.title}. Edit it or replace it with your own code.`);
    }
    // The extra line didn't move the breakpoints off their instructions.
    expect(byId('bug-save-lr').breakpoints).toEqual([11]);
    expect(byId('bug-off-by-one').breakpoints).toEqual([12]);
  });

  it('only the Full LEGv8 example needs Full LEGv8', () => {
    for (const ex of EXAMPLES) {
      const needsFull = findFullOnly(ex.code).length > 0;
      expect(needsFull, ex.id).toBe(ex.mode === 'full');
    }
    expect(EXAMPLES.filter((e) => e.mode === 'full').map((e) => e.id)).toEqual(['textbook-full']);
  });
});

describe('examples do what they say', () => {
  const group = (outcome: Example['outcome']) => EXAMPLES.filter((e) => e.outcome === outcome).map((e) => [e.id, e] as const);

  it.each(group('ok'))('%s: finishes with every expected value matching', (_id, ex) => {
    const m = finish(build(ex));
    expect(m.done).toBe(true);
    const r = results(ex, m);
    expect(r.length).toBeGreaterThan(0);
    expect(r.filter((x) => !x.ok).map((x) => `${x.key}: ${x.actual} (expected ${x.expected})`)).toEqual([]);
  });

  it('off by one: finishes with the wrong total (1024 instead of 24)', () => {
    const ex = byId('bug-off-by-one');
    const m = finish(build(ex));
    expect(m.done).toBe(true);
    expect(reg(m, 'X0')).toBe('1024');
    expect(results(ex, m).every((r) => r.ok)).toBe(false);
    // Fixing the branch (B.GE) gives the expected answer, which is the bug to find.
    const fixed = { ...ex, code: ex.code.replace('B.GT Done', 'B.GE Done') };
    const f = finish(build(fixed));
    expect(reg(f, 'X0')).toBe('24');
    expect(results(ex, f).every((r) => r.ok)).toBe(true);
  });

  it('forgetting X30: warns at the breakpoint line, and Run would never finish', () => {
    const ex = byId('bug-save-lr');
    expect(ex.code.split('\n')[ex.breakpoints![0]! - 1]).toMatch(/^BR X30/);
    const m = build(ex);
    // Step until the instruction at the breakpoint is next.
    const bpIndex = m.program.instructions.findIndex((i) => i.line === ex.breakpoints![0]);
    let steps = 0;
    while (m.state.pc !== bpIndex && steps++ < 50) m.step();
    expect(m.state.pc).toBe(bpIndex);
    expect(m.state.callWarning).toBeNull();
    m.step(); // the bad return
    expect(m.state.callWarning).toBe(
      'BR X30 went to line 11 (0x14), but Outer should return to line 7 (0x8). X30 may have been ' +
        'overwritten by a nested BL without being saved and restored.',
    );
    for (let i = 0; i < 300; i++) m.step();
    expect(m.done).toBe(false);
    expect(ex.outcome).toBe('loops');
  });

  it('the fix: never warns, returns to the caller, and restores SP', () => {
    const ex = byId('fix-save-lr');
    const m = build(ex);
    while (!m.done) {
      m.step();
      expect(m.state.callWarning).toBeNull();
    }
    expect(reg(m, 'X0')).toBe('3');
    expect(reg(m, 'X9')).toBe('99');
    expect(reg(m, 'X28')).toBe('8000');
    expect(m.state.callStack).toHaveLength(0);
  });

  it('stack pointer never set: stops with an invalid address, and setting X28 fixes it', () => {
    const ex = byId('bug-sp');
    expect(() => finish(build(ex))).toThrow(RuntimeError);
    try {
      finish(build(ex));
    } catch (e) {
      expect((e as Error).message).toBe('Error: STUR X30, [X28, #8]. Invalid address: 18446744073709551608');
    }
    const fixed = finish(build(ex, { X28: '8000' }));
    expect(fixed.done).toBe(true);
    expect(reg(fixed, 'X0')).toBe('3');
    expect(reg(fixed, 'X28')).toBe('8000');
  });

  it('procedure call and recursion show the calls they make', () => {
    const rec = build(byId('recursion-pow2'));
    let deepest = 0;
    while (!rec.done) {
      rec.step();
      deepest = Math.max(deepest, rec.state.callStack.length);
    }
    expect(deepest).toBe(4); // Pow2(3), (2), (1), (0)
    expect(rec.state.callStack).toHaveLength(0);

    const call = build(byId('procedure-call'));
    let seen = 0;
    while (!call.done) {
      call.step();
      seen = Math.max(seen, call.state.callStack.length);
    }
    expect(seen).toBe(1);
  });

  it('the Full LEGv8 example converts to code that gives the same results in zyBooks mode', () => {
    const ex = byId('textbook-full');
    const converted = convertToZyBooks(ex.code);
    expect(converted.issues).toEqual([]);
    expect(converted.changed).toBeGreaterThan(3);
    const a = finish(build(ex));
    const b = finish(build({ ...ex, code: converted.code, mode: 'zybooks' }));
    for (const r of ['X0', 'X1', 'X2', 'X28']) expect(reg(b, r), r).toBe(reg(a, r));
  });

  it('signed vs unsigned: the two comparisons really disagree', () => {
    const m = finish(build(byId('signed-unsigned')));
    expect(reg(m, 'X5')).toBe('1');
    expect(reg(m, 'X6')).toBe('0');
  });
});
