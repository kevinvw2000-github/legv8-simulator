import { Machine } from '../../src/core/machine';
import { parseProgram } from '../../src/core/parser';
import { MAX_ADDRESS } from '../../src/core/state';
import { parseWatch, watchRows } from '../../src/core/watch';

describe('parseWatch', () => {
  it('accepts decimal and hex addresses, with a default count of 1', () => {
    expect(parseWatch('4000', '')).toEqual({ address: 4000n, count: 1 });
    expect(parseWatch(' 0xFA0 ', '5')).toEqual({ address: 4000n, count: 5 });
  });

  it('rejects bad input with a helpful message', () => {
    expect(parseWatch('', '1')).toEqual({ error: 'Enter an address, e.g. 4000 or 0xFA0.' });
    expect(parseWatch('-8', '1')).toHaveProperty('error');
    expect(parseWatch('4004', '1')).toEqual({ error: 'Use a multiple of 8 (doublewords start at 4000, 4008, …).' });
    expect(parseWatch('4000', '0')).toEqual({ error: 'Watch 1 to 64 doublewords.' });
    expect(parseWatch('4000', '65')).toHaveProperty('error');
    expect(parseWatch((MAX_ADDRESS - 7n).toString(), '1')).toEqual({ address: MAX_ADDRESS - 7n, count: 1 });
    expect(parseWatch((MAX_ADDRESS - 7n).toString(), '2')).toEqual({ error: 'That range goes past the largest address.' });
  });
});

describe('watchRows', () => {
  it('shows values and changes without marking memory accessed', () => {
    const m = new Machine(parseProgram('ADDI X1, XZR, #7\nSTUR X1, [X2, #0]'), {
      registers: { X2: '4008' },
      memory: {},
    });
    expect(watchRows(m.state, 4000n, 2)).toEqual([
      { address: 4000n, value: 0n, present: false, changed: false },
      { address: 4008n, value: 0n, present: false, changed: false },
    ]);
    m.step();
    m.step();
    expect(watchRows(m.state, 4000n, 2)).toEqual([
      { address: 4000n, value: 0n, present: false, changed: false },
      { address: 4008n, value: 7n, present: true, changed: true },
    ]);
    // Only the stored doubleword is in the zyBooks-style memory view.
    expect(m.state.memoryView().map((r) => r.address)).toEqual(['4008']);
  });
});
