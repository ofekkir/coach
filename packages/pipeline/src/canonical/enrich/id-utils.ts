import type { OtlpAttribute, OtlpSpan, TempoTrace } from '../../types.ts';

/** Prefix applied to all canonical span IDs to distinguish them from raw base64 span IDs. */
export const SPAN_ID_PREFIX = 's';

export interface SpanMeta {
  readonly id: string;
  readonly b64: string;
  readonly parentB64: string | null;
  readonly startNs: bigint;
  readonly endNs: bigint;
  readonly spanType: string;
  readonly toolName: string | null;
  readonly requestId: string | null;
}

export function b64toHex(b64: string): string {
  return Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

export function strAttr(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function getStringAttr(attrs: readonly OtlpAttribute[], key: string): string | null {
  const a = attrs.find((x) => x.key === key);
  if (!a) return null;
  return 'stringValue' in a.value ? a.value.stringValue : null;
}

export function allSpansFlat(trace: TempoTrace): OtlpSpan[] {
  return trace.batches.flatMap((batch) => batch.scopeSpans.flatMap((ss) => ss.spans));
}

export function collectSpanMeta(trace: TempoTrace): SpanMeta[] {
  const metas = allSpansFlat(trace).map((span) => ({
    id: SPAN_ID_PREFIX + b64toHex(span.spanId),
    b64: span.spanId,
    parentB64: span.parentSpanId ?? null,
    startNs: BigInt(span.startTimeUnixNano),
    endNs: BigInt(span.endTimeUnixNano),
    spanType: getStringAttr(span.attributes, 'span.type') ?? span.name,
    toolName: getStringAttr(span.attributes, 'tool_name'),
    requestId: getStringAttr(span.attributes, 'request_id'),
  }));
  metas.sort((a, b) => (a.startNs < b.startNs ? -1 : a.startNs > b.startNs ? 1 : 0));
  return metas;
}

export function narrowestContaining(metas: readonly SpanMeta[], ns: bigint): SpanMeta | null {
  let best: SpanMeta | null = null;
  let bestDur = BigInt(-1);
  for (const m of metas) {
    if (ns < m.startNs || ns > m.endNs) continue;
    const dur = m.endNs - m.startNs;
    if (best === null || dur < bestDur) {
      best = m;
      bestDur = dur;
    }
  }
  return best;
}

export function lastEndedBefore(metas: readonly SpanMeta[], ns: bigint): SpanMeta | null {
  let best: SpanMeta | null = null;
  for (const m of metas) {
    if (m.endNs <= ns && (best === null || m.endNs > best.endNs)) best = m;
  }
  return best;
}
