import { describeValue, formatValue, u64 } from '../../src/core/bits';

describe('formatValue', () => {
  const minus7 = u64(-7n);

  it('signed and unsigned decimal', () => {
    expect(formatValue(minus7, 'signed')).toBe('-7');
    expect(formatValue(minus7, 'unsigned')).toBe('18446744073709551609');
    expect(formatValue(4000n, 'signed')).toBe('4000');
    expect(formatValue(4000n, 'unsigned')).toBe('4000');
  });

  it('accepts signed BigInts by wrapping them to 64 bits', () => {
    expect(formatValue(-1n, 'unsigned')).toBe('18446744073709551615');
    expect(formatValue(-1n, 'signed')).toBe('-1');
  });

  it('hex shows all 16 digits in groups of 4', () => {
    expect(formatValue(4000n, 'hex')).toBe('0x0000_0000_0000_0FA0');
    expect(formatValue(minus7, 'hex')).toBe('0xFFFF_FFFF_FFFF_FFF9');
    expect(formatValue(0n, 'hex')).toBe('0x0000_0000_0000_0000');
    expect(formatValue(1n << 63n, 'hex')).toBe('0x8000_0000_0000_0000');
  });

  it('binary shows 64 bits as two lines of nibbles, high half first', () => {
    const [high, low] = formatValue(5n, 'binary').split('\n');
    expect(high).toBe('0000 0000 0000 0000 0000 0000 0000 0000');
    expect(low).toBe('0000 0000 0000 0000 0000 0000 0000 0101');
    const [h, l] = formatValue((1n << 63n) | 1n, 'binary').split('\n');
    expect(h!.startsWith('1000 ')).toBe(true);
    expect(l!.endsWith(' 0001')).toBe(true);
    expect(formatValue(minus7, 'binary').replace(/\s/g, '')).toBe('1'.repeat(60) + '1001');
  });

  it('describeValue lists every format', () => {
    expect(describeValue(minus7)).toBe(
      [
        'Signed: -7',
        'Unsigned: 18446744073709551609',
        'Hex: 0xFFFF_FFFF_FFFF_FFF9',
        `Binary: ${'1111 '.repeat(15)}1001`,
      ].join('\n'),
    );
  });
});
