import type { LogEntry, OtlpAttribute, OtlpBatch, OtlpSpan, TempoTrace } from '../../types.ts';
import { allSpansFlat, collectSpanMeta, strAttr } from './id-utils.ts';
import type { SpanMeta } from './id-utils.ts';
import {
  attributeLogsToSpans,
  buildRequestBodyIndex,
  buildToolInputIndex,
  summarizeToolInput,
} from './logs.ts';
import { extractHooks, resolveHookParentB64 } from './hooks.ts';
import type { HookEntry } from './hooks.ts';

function hookSpanB64(index: number): string {
  function uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }
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
  return uint8ToBase64(deterministicBytes(`coach-hook-span-${String(index)}`, 8));
}

function resolveRawRequestBody(
  meta: SpanMeta,
  logs: LogEntry[],
  requestBodyIndex: Map<string, string>,
): string | null {
  return (
    (meta.requestId != null ? requestBodyIndex.get(meta.requestId) : undefined) ??
    logs.find((l) => l.event_name === 'api_request_body' && l.body != null)?.body ??
    null
  );
}

function buildLlmExtraAttrs(
  meta: SpanMeta,
  logs: LogEntry[],
  requestBodyIndex: Map<string, string>,
): OtlpAttribute[] {
  const apiLog = logs.find((l) => l.event_name === 'api_request');
  const responseLog = logs.find((l) => l.event_name === 'api_response_body' && l.body != null);
  const rawRequestBody = resolveRawRequestBody(meta, logs, requestBodyIndex);

  const extra: OtlpAttribute[] = [];
  if (apiLog?.query_source != null) extra.push(strAttr('query_source', apiLog.query_source));
  if (apiLog?.cost_usd != null) extra.push(strAttr('cost_usd', apiLog.cost_usd));
  if (rawRequestBody != null) extra.push(strAttr('raw_request_body', rawRequestBody));
  if (responseLog?.body != null) extra.push(strAttr('raw_response_body', responseLog.body));
  return extra;
}

function enrichLlmSpan(
  span: OtlpSpan,
  meta: SpanMeta,
  logs: LogEntry[],
  requestBodyIndex: Map<string, string>,
): OtlpSpan {
  const extra = buildLlmExtraAttrs(meta, logs, requestBodyIndex);
  return extra.length > 0 ? { ...span, attributes: [...span.attributes, ...extra] } : span;
}

function enrichToolSpan(span: OtlpSpan, toolInput: string | null): OtlpSpan {
  if (toolInput == null) return span;
  const summary = summarizeToolInput(toolInput);
  if (summary == null) return span;
  return { ...span, attributes: [...span.attributes, strAttr('tool_input_summary', summary)] };
}

function enrichSpan(
  span: OtlpSpan,
  meta: SpanMeta,
  logs: LogEntry[],
  toolInput: string | null,
  requestBodyIndex: Map<string, string>,
): OtlpSpan {
  if (meta.spanType === 'llm_request') return enrichLlmSpan(span, meta, logs, requestBodyIndex);
  if (meta.spanType === 'tool') return enrichToolSpan(span, toolInput);
  return span;
}

function enrichSpanInBatch(
  span: OtlpSpan,
  metas: SpanMeta[],
  logsBySpan: Map<string, LogEntry[]>,
  toolInputBySpanId: Map<string, string>,
  requestBodyIndex: Map<string, string>,
): OtlpSpan {
  const meta = metas.find((m) => m.b64 === span.spanId);
  if (meta == null) return span;
  const spanLogs = logsBySpan.get(meta.id) ?? [];
  const toolInput = toolInputBySpanId.get(meta.id) ?? null;
  return enrichSpan(span, meta, spanLogs, toolInput, requestBodyIndex);
}

function enrichScopeSpan(
  ss: { spans: readonly OtlpSpan[] },
  metas: SpanMeta[],
  logsBySpan: Map<string, LogEntry[]>,
  toolInputBySpanId: Map<string, string>,
  requestBodyIndex: Map<string, string>,
): { spans: OtlpSpan[] } {
  return {
    ...ss,
    spans: ss.spans.map((span) =>
      enrichSpanInBatch(span, metas, logsBySpan, toolInputBySpanId, requestBodyIndex),
    ),
  };
}

function buildHookSpan(tId: string, hook: HookEntry, metas: SpanMeta[]): OtlpSpan {
  const hookB64 = hookSpanB64(hook.index);
  const parentB64 = resolveHookParentB64(metas, hook);

  const span: OtlpSpan = {
    traceId: tId,
    spanId: hookB64,
    name: 'claude_code.hook',
    startTimeUnixNano: String(hook.startNs),
    endTimeUnixNano: String(hook.endNs),
    attributes: [
      strAttr('span.type', 'hook'),
      strAttr('hook.name', hook.hookName),
      ...(hook.durationMs != null ? [strAttr('duration_ms', String(hook.durationMs))] : []),
    ],
  };

  if (parentB64) return { ...span, parentSpanId: parentB64 };
  return span;
}

function appendHookSpans(enrichedBatches: OtlpBatch[], hookSpans: OtlpSpan[]): OtlpBatch[] {
  if (enrichedBatches.length === 0) return [];
  const [first, ...rest] = enrichedBatches as [OtlpBatch, ...OtlpBatch[]];
  const [firstScope, ...otherScopes] = first.scopeSpans as [
    { spans: readonly OtlpSpan[] },
    ...{ spans: readonly OtlpSpan[] }[],
  ];
  const enrichedFirst: OtlpBatch = {
    ...first,
    scopeSpans: [{ ...firstScope, spans: [...firstScope.spans, ...hookSpans] }, ...otherScopes],
  };
  return [enrichedFirst, ...rest];
}

export function enrichTrace(trace: TempoTrace, logs: readonly LogEntry[]): TempoTrace {
  const traceId = allSpansFlat(trace)[0]?.traceId ?? '';
  const metas = collectSpanMeta(trace);
  const logsBySpan = attributeLogsToSpans(metas, logs);
  const toolInputBySpanId = buildToolInputIndex(metas, logs, logsBySpan);
  const requestBodyIndex = buildRequestBodyIndex(logs);
  const hooks = extractHooks(logs);

  const enrichedBatches: OtlpBatch[] = trace.batches.map((batch) => ({
    ...batch,
    scopeSpans: batch.scopeSpans.map((ss) =>
      enrichScopeSpan(ss, metas, logsBySpan, toolInputBySpanId, requestBodyIndex),
    ),
  }));

  const hookSpans = hooks.map((hook) => buildHookSpan(traceId, hook, metas));

  if (hookSpans.length === 0) return { batches: enrichedBatches };
  return { batches: appendHookSpans(enrichedBatches, hookSpans) };
}
