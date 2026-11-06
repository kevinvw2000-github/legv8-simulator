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
