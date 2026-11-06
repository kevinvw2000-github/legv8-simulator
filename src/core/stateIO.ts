// Import/export in the zyBooks simulator's text format (docs/COMPATIBILITY.md):
//   {"code":"...","registers":"X2 5, X3 4","memory":"4000 30, 4008 1"}
// `registers` and `memory` are "name value" pairs joined by ", ". Values are 64-bit decimals.

import { REGISTER_INDEX } from './isa';
import { MAX_ADDRESS } from './state';

export interface Entry {
  key: string;
  value: string;
}

export interface Workspace {
  code: string;
  registers: Entry[];
  memory: Entry[];
}

/** Partial result of an import: zyBooks only replaces the fields present as strings. */
export type ImportedWorkspace = Partial<Workspace>;

export const IMPORT_PARSE_ERROR = 'Import string could not be parsed. Perhaps try exporting again.';
export const REGISTERS_FORMAT_ERROR = 'Registers format or naming invalid.';
export const MEMORY_FORMAT_ERROR = 'Memory format or naming invalid.';

const INT = /^-?\d+$/;
const MIN_S64 = -(1n << 63n);
const MAX_U64 = (1n << 64n) - 1n;

function joinPairs(entries: Entry[]): string {
  return entries.map((e) => `${e.key} ${e.value}`).join(', ');
}

/** Split "a 1, b 2" into pairs. An empty string means no entries. */
function splitPairs(text: string): Array<[string, string]> | null {
  if (text.trim() === '') return [];
  const pairs: Array<[string, string]> = [];
  for (const part of text.split(',')) {
    const bits = part.trim().split(/\s+/);
    if (bits.length !== 2) return null;
    pairs.push([bits[0] as string, bits[1] as string]);
  }
  return pairs;
}

const validValue = (v: string): boolean => INT.test(v) && BigInt(v) >= MIN_S64 && BigInt(v) <= MAX_U64;

/** Serialize a workspace exactly like zyBooks' Export. */
export function exportWorkspace(ws: Workspace): string {
  return JSON.stringify({ code: ws.code, registers: joinPairs(ws.registers), memory: joinPairs(ws.memory) });
}

/** Parse a zyBooks export string. Throws Error with the zyBooks message on bad input. */
export function importWorkspace(text: string): ImportedWorkspace {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(IMPORT_PARSE_ERROR);
  }
  if (typeof data !== 'object' || data === null) throw new Error(IMPORT_PARSE_ERROR);
  const obj = data as Record<string, unknown>;
  const out: ImportedWorkspace = {};

  if (typeof obj.code === 'string') out.code = obj.code;

  if (typeof obj.registers === 'string') {
    const pairs = splitPairs(obj.registers);
    if (!pairs || pairs.some(([name, value]) => REGISTER_INDEX[name] === undefined || !validValue(value))) {
      throw new Error(REGISTERS_FORMAT_ERROR);
    }
    // XZR can't hold a value, so it isn't kept as an initial value.
    out.registers = dedupe(pairs.filter(([name]) => name !== 'XZR'));
  }

  if (typeof obj.memory === 'string') {
    const pairs = splitPairs(obj.memory);
    if (
      !pairs ||
      pairs.some(([addr, value]) => !/^\d+$/.test(addr) || BigInt(addr) > MAX_ADDRESS || !validValue(value))
    ) {
      throw new Error(MEMORY_FORMAT_ERROR);
    }
    out.memory = dedupe(pairs);
  }

  return out;
}

/** Later pairs win, like repeated assignments. Keeps first-seen order. */
function dedupe(pairs: Array<[string, string]>): Entry[] {
  const map = new Map<string, string>();
  for (const [key, value] of pairs) map.set(key, value);
  return [...map].map(([key, value]) => ({ key, value }));
}
