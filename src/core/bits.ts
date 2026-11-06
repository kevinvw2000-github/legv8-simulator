// 64-bit helpers. All register values are stored as unsigned BigInt in [0, 2^64).

export const MASK64 = (1n << 64n) - 1n;
export const SIGN_BIT = 1n << 63n;

/** Wrap any BigInt into the unsigned 64-bit range. */
export const u64 = (v: bigint): bigint => v & MASK64;

/** Interpret an unsigned 64-bit value as two's-complement signed. */
export const s64 = (v: bigint): bigint => (v & SIGN_BIT ? v - (1n << 64n) : v);

/** True when bit 63 is set. */
export const isNeg = (v: bigint): boolean => (v & SIGN_BIT) !== 0n;

/** Sign-extend a JS number immediate to an unsigned 64-bit value. */
export const imm64 = (n: number): bigint => u64(BigInt(n));

/** Parse a decimal string (signed or unsigned) into an unsigned 64-bit value. */
export function parseValue(text: string): bigint {
  const t = text.trim();
  if (!/^-?\d+$/.test(t)) throw new Error(`Not a valid integer: ${text}`);
  return u64(BigInt(t));
}

/** Signed decimal text, as zyBooks displays values. */
export const formatSigned = (v: bigint): string => s64(v).toString();

/** Ways the interface can display a 64-bit value. Input and import/export always use signed decimal. */
export const VALUE_FORMATS = ['signed', 'unsigned', 'hex', 'binary'] as const;
export type ValueFormat = (typeof VALUE_FORMATS)[number];

/** Split a string into groups of `size` characters, keeping the end aligned. */
const group = (s: string, size: number, sep: string): string =>
  s.match(new RegExp(`.{${size}}`, 'g'))!.join(sep);

/**
 * Format a 64-bit value (any BigInt; it is wrapped to 64 bits first).
 * - signed:   -7
 * - unsigned: 18446744073709551609
 * - hex:      0xFFFF_FFFF_FFFF_FFF9 (all 16 digits, in groups of 4)
 * - binary:   all 64 bits in nibbles, as two lines of 32 bits (high half first)
 */
export function formatValue(v: bigint, format: ValueFormat): string {
  const x = u64(v);
  switch (format) {
    case 'signed':
      return s64(x).toString();
    case 'unsigned':
      return x.toString();
    case 'hex':
      return '0x' + group(x.toString(16).toUpperCase().padStart(16, '0'), 4, '_');
    case 'binary': {
      const bits = x.toString(2).padStart(64, '0');
      return `${group(bits.slice(0, 32), 4, ' ')}\n${group(bits.slice(32), 4, ' ')}`;
    }
  }
}

/** Every format at once, for hover tooltips. */
export function describeValue(v: bigint): string {
  return [
    `Signed: ${formatValue(v, 'signed')}`,
    `Unsigned: ${formatValue(v, 'unsigned')}`,
    `Hex: ${formatValue(v, 'hex')}`,
    `Binary: ${formatValue(v, 'binary').replace('\n', ' ')}`,
  ].join('\n');
}
