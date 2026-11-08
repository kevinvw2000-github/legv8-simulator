import { Machine } from '../../src/core/machine';
import { parseProgram } from '../../src/core/parser';
import { checkExpected, parseExpected, summarize, type ExpectedEntry } from '../../src/core/expected';

const entries = (kind: 'registers' | 'memory', text: string): ExpectedEntry[] => {
  const p = parseExpected(kind, text);
  if ('error' in p) throw new Error(p.error);
  return p.entries;
};

describe('parseExpected', () => {
  it('reads the zyBooks pair format', () => {
    expect(parseExpected('registers', '')).toEqual({ entries: [] });
    expect(parseExpected('registers', ' X0 15,x9  -1 ')).toEqual({
      entries: [{ key: 'X0', value: 15n }, { key: 'X9', value: (1n << 64n) - 1n }],
    });
    expect(parseExpected('memory', '5000 1, 05008 350')).toEqual({
      entries: [{ key: '5000', value: 1n }, { key: '5008', value: 350n }],
    });
  });

  it('explains mistakes', () => {
    expect(parseExpected('registers', 'X0=15')).toEqual({ error: 'Use pairs separated by commas, e.g. X0 15, X9 -1' });
    expect(parseExpected('registers', 'X31 1')).toEqual({ error: "X31 isn't a register (X0–X30 or XZR)." });
    expect(parseExpected('registers', 'X1 1.5')).toEqual({ error: "1.5 isn't a 64-bit whole number." });
    expect(parseExpected('registers', 'X1 1, X1 2')).toEqual({ error: 'X1 is listed twice.' });
    expect(parseExpected('memory', '5004 1')).toEqual({
      error: "5004 isn't a multiple of 8 (doublewords start at 0, 8, 16, …).",
    });
    expect(parseExpected('memory', '5000 1,')).toHaveProperty('error');
  });
});

describe('checkExpected', () => {
  it('compares as 64-bit values and treats untouched values as 0', () => {
    const m = new Machine(parseProgram('SUBI X1, XZR, #1\nSTUR X1, [X2, #0]'), { registers: { X2: '5000' }, memory: {} });
    m.step();
    m.step();
    const results = checkExpected(
      m.state,
      entries('registers', 'X1 18446744073709551615, X3 0, X4 7'),
      entries('memory', '5000 -1, 6000 0'),
    );
    expect(results.map((r) => [r.key, r.ok, r.accessed])).toEqual([
      ['X1', true, true],
      ['X3', true, false],
      ['X4', false, false],
      ['5000', true, true],
      ['6000', true, false],
    ]);
    // Checking never marks anything accessed.
    expect(m.state.registerView().map((r) => r.name)).toEqual(['X1', 'X2', 'XZR']);
    expect(m.state.memoryView().map((r) => r.address)).toEqual(['5000']);
    expect(summarize(results)).toBe('Expected values: 4 of 5 match. X4 is 0, expected 7.');
  });

  it('summarizes', () => {
    const r = (key: string, ok: boolean) =>
      ({ kind: 'memory', key, expected: 1n, actual: ok ? 1n : (1n << 64n) - 2n, accessed: true, ok }) as const;
    expect(summarize([r('8', true)])).toBe('Expected value matches.');
    expect(summarize([r('8', true), r('16', true)])).toBe('Expected values: all 2 match.');
    expect(summarize([r('8', false), r('16', false), r('24', false), r('32', false)])).toBe(
      'Expected values: 0 of 4 match. Memory 8 is -2, expected 1; Memory 16 is -2, expected 1; ' +
        'Memory 24 is -2, expected 1 (and 1 more).',
    );
  });
});
