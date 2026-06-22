import type { OtlpAttribute } from '../../types.ts';
import {
  FNV_OFFSET_BASIS,
  FNV_PRIME,
  HIGH_BYTE_SHIFT,
  LCG_INCREMENT,
  LCG_MULTIPLIER,
  NS_PER_MS,
  SPAN_ID_BYTES,
  TRACE_ID_BYTES,
} from '../../types.ts';

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// Why: pure arithmetic + Web APIs only (FNV-1a → LCG) so the same seed yields
// identical bytes in both browser and Node.js — no crypto/node:* dependency.
function deterministicBytes(seed: string, len: number): Uint8Array {
  let h = FNV_OFFSET_BASIS >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) >>> 0;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    h = (Math.imul(h, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    out[i] = h >>> HIGH_BYTE_SHIFT;
  }
  return out;
}

export function spanB64(kind: string, id: string): string {
  return uint8ToBase64(deterministicBytes(`${kind}:${id}`, SPAN_ID_BYTES));
}

export function traceB64(sessionId: string): string {
  return uint8ToBase64(deterministicBytes(sessionId, TRACE_ID_BYTES));
}

export function isoToNano(iso: string): string {
  return String(BigInt(Date.parse(iso)) * NS_PER_MS);
}

export function clampEnd(start: string, end: string): string {
  return BigInt(end) >= BigInt(start) ? end : start;
}

export function strAttr(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

export function intAttr(key: string, value: number): OtlpAttribute {
  return { key, value: { intValue: String(value) } };
}
