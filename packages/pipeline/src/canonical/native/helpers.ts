import type { OtlpAttribute } from '../../types.ts';
import { NS_PER_MS } from '../../types.ts';

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// Deterministic pseudo-random bytes from a seed string (FNV-1a → LCG).
// No imports required — works identically in browser and Node.js.
function deterministicBytes(seed: string, len: number): Uint8Array {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    out[i] = h >>> 24;
  }
  return out;
}

export function spanB64(kind: string, id: string): string {
  return uint8ToBase64(deterministicBytes(`${kind}:${id}`, 8));
}

export function traceB64(sessionId: string): string {
  return uint8ToBase64(deterministicBytes(sessionId, 16));
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
