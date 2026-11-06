import { runProgram, type Storage } from '../../src/core/machine';

function run(source: string, init: Partial<Storage> = {}) {
  return runProgram(source, { registers: {}, memory: {}, ...init }, { maxSteps: 10_000 });
}

function storage(source: string, init: Partial<Storage> = {}): Storage {
  const r = run(source, init);
  if (r.kind !== 'finished') throw new Error(`${r.kind}: ${r.message}`);
  return r.storage;
}

describe('LDUR / STUR', () => {
  it('stores and loads a doubleword', () => {
    const s = storage('STUR X1, [X2, #8]\nLDUR X3, [X2, #8]', { registers: { X1: '-42', X2: '4000' } });
    expect(s.registers.X3).toBe('-42');
    expect(s.memory).toEqual({ '4008': '-42' });
  });

  it('loads initial memory', () => {
    const s = storage('LDUR X1, [X2, #0]', { registers: { X2: '4000' }, memory: { '4000': '30' } });
    expect(s.registers.X1).toBe('30');
  });

  it('uses negative offsets', () => {
    const s = storage('STUR X1, [X2, #-8]', { registers: { X1: '7', X2: '4008' } });
    expect(s.memory).toEqual({ '4000': '7' });
  });

  it('allows unaligned access', () => {
    const s = storage('STUR X1, [X2, #1]\nLDUR X3, [X2, #1]', { registers: { X1: '-1', X2: '4000' } });
    expect(s.registers.X3).toBe('-1');
    // Bytes 4001..4008 span two rows: 4000 holds 0xFFFFFFFFFFFFFF00, 4008 holds 0xFF.
    expect(s.memory).toEqual({ '4000': '-256', '4008': '255' });
  });
});

describe('little-endian sub-word access', () => {
  const init = { registers: { X1: (0x8899aabbccddeeffn - (1n << 64n)).toString(), X2: '4000' } };

  it('LDURB / LDURH zero-extend, LDURSW sign-extends', () => {
    const s = storage(
      'STUR X1, [X2, #0]\nLDURB X3, [X2, #0]\nLDURB X4, [X2, #7]\nLDURH X5, [X2, #0]\nLDURSW X6, [X2, #0]\nLDURSW X7, [X2, #4]',
      init,
    );
    expect(s.registers.X3).toBe(String(0xff));
    expect(s.registers.X4).toBe(String(0x88));
    expect(s.registers.X5).toBe(String(0xeeff));
    expect(s.registers.X6).toBe(String(0xccddeeff - 2 ** 32));
    expect(s.registers.X7).toBe(String(0x8899aabb - 2 ** 32));
  });

  it('LDURSW of a positive word does not sign-extend', () => {
    const s = storage('LDURSW X1, [X2, #0]', { registers: { X2: '4000' }, memory: { '4000': '2147483647' } });
    expect(s.registers.X1).toBe('2147483647');
  });

  it('STURB / STURH / STURW write only their low bytes', () => {
    const s = storage(
      'STUR XZR, [X2, #0]\nSTURB X1, [X2, #0]\nSTURH X1, [X2, #2]\nSTURW X1, [X2, #4]\nLDUR X3, [X2, #0]',
      init,
    );
    expect(BigInt(s.registers.X3 as string) & ((1n << 64n) - 1n)).toBe(0xccddeeffeeff00ffn);
  });
});

describe('memory panel', () => {
  it('a read creates a visible 0 entry (P4)', () => {
    expect(storage('LDUR X1, [XZR, #200]')).toEqual({ registers: { X1: '0', XZR: '0' }, memory: { '200': '0' } });
  });

  it('groups bytes into 8-byte rows in address order', () => {
    const s = storage('STURB X1, [X2, #20]\nSTURB X1, [X2, #3]', { registers: { X1: '1', X2: '4000' } });
    expect(Object.keys(s.memory)).toEqual(['4000', '4016']);
    expect(s.memory['4016']).toBe(String(2 ** 32)); // byte 4020 is offset 4 of row 4016
  });
});

describe('invalid addresses', () => {
  it('negative addresses wrap and are reported unsigned', () => {
    expect(run('LDUR X1, [XZR, #-8]')).toEqual({
      kind: 'runtimeError',
      message: 'Error: LDUR X1, [XZR, #-8]. Invalid address: 18446744073709551608',
    });
  });

  it('reports the first out-of-range byte', () => {
    const top = ((1n << 62n) - 4n).toString();
    expect(run('STUR X1, [X2, #0]', { registers: { X2: top } })).toEqual({
      kind: 'runtimeError',
      message: `Error: STUR X1, [X2, #0]. Invalid address: ${1n << 62n}`,
    });
  });

  it('accepts the last valid byte', () => {
    const last = ((1n << 62n) - 1n).toString();
    const s = storage('STURB X1, [X2, #0]', { registers: { X1: '9', X2: last } });
    expect(Object.keys(s.memory)).toEqual([((1n << 62n) - 8n).toString()]);
  });
});

describe('loop that stores to an array', () => {
  // Store the squares 0, 1, 4, 9, 16 as doublewords starting at X20.
  const src = [
    'ADDI X2, XZR, #0',
    'ADD X3, X20, XZR',
    'Loop:',
    'SUBS XZR, X2, X19',
    'B.GE Exit',
    'MUL X4, X2, X2',
    'STUR X4, [X3, #0]',
    'ADDI X3, X3, #8',
    'ADDI X2, X2, #1',
    'B Loop',
    'Exit:',
  ].join('\n');

  it('fills 5000..5032 with 0, 1, 4, 9, 16', () => {
    const s = storage(src, { registers: { X19: '5', X20: '5000' } });
    expect(s.memory).toEqual({ '5000': '0', '5008': '1', '5016': '4', '5024': '9', '5032': '16' });
  });
});
