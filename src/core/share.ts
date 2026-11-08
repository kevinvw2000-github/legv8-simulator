// Share links: a workspace compressed into the URL fragment (#s1=…). Browsers never send the
// fragment to the server, so nothing is uploaded.

import { parseWatch, type WatchSpec } from './watch';
import type { Mode } from './state';

export interface SharedWorkspace {
  code: string;
  registers: Array<{ key: string; value: string }>;
  memory: Array<{ key: string; value: string }>;
  watches: WatchSpec[];
  breakpoints: number[];
  mode: Mode;
  /** Expected-results fields in pair format ("X0 15, X9 -1"). */
  expected: { registers: string; memory: string };
}

const PREFIX = '#s1=';
/** Links longer than this may be cut off by some chat apps and email clients. */
export const LONG_LINK = 8000;

export class ShareLinkError extends Error {}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** The fragment for a workspace, including the leading '#'. */
export async function encodeShare(ws: SharedWorkspace): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(ws));
  return PREFIX + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** True when a URL fragment looks like a share link (it may still be damaged). */
export const isShareHash = (hash: string): boolean => hash.startsWith(PREFIX);

/** Read a share fragment. Throws ShareLinkError if it is damaged (e.g. cut off when pasted). */
export async function decodeShare(hash: string): Promise<SharedWorkspace> {
  if (!isShareHash(hash)) throw new ShareLinkError('Not a share link.');
  let data: unknown;
  try {
    const bytes = await pipe(fromBase64Url(hash.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ShareLinkError('This share link is damaged or incomplete. It may have been cut off when it was copied.');
  }
  return sanitize(data);
}

const isEntry = (e: unknown): e is { key: string; value: string } =>
  typeof e === 'object' && e !== null && typeof (e as any).key === 'string' && typeof (e as any).value === 'string';

/** Keep only well-formed watches (also used for saved state). */
export function sanitizeWatches(v: unknown): WatchSpec[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((w) => {
    if (typeof w !== 'object' || w === null) return [];
    const p = parseWatch(String(w.address ?? ''), String(w.count ?? ''));
    if ('error' in p) return [];
    return [{ label: typeof w.label === 'string' ? w.label.slice(0, 24) : '', address: p.address.toString(), count: p.count }];
  });
}

/** Turn decoded JSON into a workspace, dropping anything malformed. */
function sanitize(data: unknown): SharedWorkspace {
  if (typeof data !== 'object' || data === null || typeof (data as any).code !== 'string') {
    throw new ShareLinkError('This share link is damaged or incomplete. It may have been cut off when it was copied.');
  }
  const d = data as Record<string, unknown>;
  const entries = (v: unknown) =>
    Array.isArray(v) ? v.filter(isEntry).map((e) => ({ key: e.key, value: e.value })) : [];
  return {
    code: d.code as string,
    registers: entries(d.registers),
    memory: entries(d.memory),
    watches: sanitizeWatches(d.watches),
    breakpoints: Array.isArray(d.breakpoints) ? d.breakpoints.filter((n) => Number.isInteger(n) && n > 0) : [],
    mode: d.mode === 'arm' ? 'arm' : 'zybooks',
    expected: sanitizeExpected(d.expected),
  };
}

/** Expected-results text fields; anything else becomes empty. */
export function sanitizeExpected(v: unknown): { registers: string; memory: string } {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === 'string' ? x.slice(0, 4000) : '');
  return { registers: text(o.registers), memory: text(o.memory) };
}
