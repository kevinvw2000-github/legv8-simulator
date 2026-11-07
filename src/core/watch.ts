// Memory watch: doubleword ranges the user pins so they're always shown, even before the
// program touches them. Watching reads memory without marking it accessed, so the zyBooks-style
// Memory panel is unaffected.

import { MAX_ADDRESS, type MachineState } from './state';

/** A saved watch, as the user typed it (address in decimal). */
export interface WatchSpec {
  label: string;
  address: string;
  /** Number of doublewords. */
  count: number;
}

export const MAX_WATCH_COUNT = 64;

/**
 * Check a new watch. Addresses are decimal, or hex with 0x, and must be a multiple of 8 so
 * the rows line up with the Memory panel's doublewords. Returns the parsed values or an error.
 */
export function parseWatch(
  addressText: string,
  countText: string,
): { address: bigint; count: number } | { error: string } {
  const a = addressText.trim().replace(/_/g, '');
  if (!/^(\d+|0x[0-9a-f]+)$/i.test(a)) return { error: 'Enter an address, e.g. 4000 or 0xFA0.' };
  const address = BigInt(a);
  if (address % 8n !== 0n) return { error: `Use a multiple of 8 (doublewords start at ${address - (address % 8n)}, ${address - (address % 8n) + 8n}, …).` };
  const c = countText.trim() === '' ? '1' : countText.trim();
  if (!/^\d+$/.test(c) || Number(c) < 1 || Number(c) > MAX_WATCH_COUNT) {
    return { error: `Watch 1 to ${MAX_WATCH_COUNT} doublewords.` };
  }
  const count = Number(c);
  if (address + BigInt(count) * 8n - 1n > MAX_ADDRESS) return { error: 'That range goes past the largest address.' };
  return { address, count };
}

export interface WatchRow {
  address: bigint;
  /** Unsigned 64-bit value. */
  value: bigint;
  /** False when no byte of this doubleword has been accessed yet. */
  present: boolean;
  /** Written by the last step (same highlighting as the Memory panel). */
  changed: boolean;
}

/** Current values of a watched range, without marking anything accessed. */
export function watchRows(st: MachineState, address: bigint, count: number): WatchRow[] {
  const rows: WatchRow[] = [];
  for (let i = 0; i < count; i++) {
    const a = address + BigInt(i) * 8n;
    const { value, present } = st.peekDoubleword(a);
    rows.push({ address: a, value, present, changed: st.changedRows.has(a) });
  }
  return rows;
}
