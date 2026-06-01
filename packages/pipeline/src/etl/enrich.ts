import type { LogEntry, OtlpAttribute, OtlpBatch, OtlpSpan, TempoTrace } from './types.ts';

// ── Browser-compatible ID helpers (no node:buffer / node:crypto) ──────────────

function b64toHex(b64: string): string {
  return Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// Deterministic pseudo-random bytes from a seed string (FNV-1a → LCG).
// No imports required — works identically in browser and Node.js.
function deterministicBytes(seed: string, len: number): Uint8Array {
  let h = 2166136261 >>> 0; // FNV offset basis
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0; // FNV prime
  }
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0; // LCG
    out[i] = h >>> 24; // high byte has best distribution
  }
  return out;
}

// Deterministic 8-byte span ID for synthetic hook spans
function hookSpanB64(index: number): string {
  return uint8ToBase64(deterministicBytes(`coach-hook-span-${String(index)}`, 8));
}

// ── Attribute helpers ─────────────────────────────────────────────────────────

function strAttr(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function getStringAttr(attrs: readonly OtlpAttribute[], key: string): string | null {
  const a = attrs.find((x) => x.key === key);
  if (!a) return null;
  return 'stringValue' in a.value ? a.value.stringValue : null;
}

// ── Log utilities (same attribution logic as transform.ts) ───────────────────

interface SpanMeta {
  readonly id: string; // 's' + hex
  readonly b64: string;
  readonly parentB64: string | null;
  readonly startNs: bigint;
  readonly endNs: bigint;
  readonly spanType: string;
  readonly toolName: string | null;
  readonly requestId: string | null;
}

function allSpansFlat(trace: TempoTrace): OtlpSpan[] {
  return trace.batches.flatMap((batch) => batch.scopeSpans.flatMap((ss) => ss.spans));
}

function collectSpanMeta(trace: TempoTrace): SpanMeta[] {
  const metas = allSpansFlat(trace).map((span) => ({
    id: 's' + b64toHex(span.spanId),
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

function narrowestContaining(metas: readonly SpanMeta[], ns: bigint): SpanMeta | null {
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

function lastEndedBefore(metas: readonly SpanMeta[], ns: bigint): SpanMeta | null {
  let best: SpanMeta | null = null;
  for (const m of metas) {
    if (m.endNs <= ns && (best === null || m.endNs > best.endNs)) best = m;
  }
  return best;
}

function attributeLogsToSpans(
  metas: readonly SpanMeta[],
  logs: readonly LogEntry[],
): Map<string, LogEntry[]> {
  const requestIdIndex = new Map<string, string>();
  const childIds = new Set<string>();
  for (const m of metas) {
    if (m.requestId !== null) requestIdIndex.set(m.requestId, m.id);
    if (m.parentB64 !== null) childIds.add(m.id);
  }

  const sorted = [...logs].sort(
    (a, b) => parseInt(a.event_sequence, 10) - parseInt(b.event_sequence, 10),
  );

  const bySpan = new Map<string, LogEntry[]>();
  for (const log of sorted) {
    let target: string;
    if (log.request_id != null) {
      target = requestIdIndex.get(log.request_id) ?? log.span_id;
    } else if (childIds.has(log.span_id)) {
      target = log.span_id;
    } else {
      const m = narrowestContaining(metas, BigInt(log.timestamp_ns));
      target = m !== null ? m.id : log.span_id;
    }
    const bucket = bySpan.get(target);
    if (bucket !== undefined) bucket.push(log);
    else bySpan.set(target, [log]);
  }

  return bySpan;
}

// ── Request body index ────────────────────────────────────────────────────────

// api_request_body logs lack request_id; pair them positionally with
// api_response_body logs (both ordered by event_sequence) to get a
// request_id → raw_request_body map that works even when timestamps
// place the request log outside the span's time window.
function buildRequestBodyIndex(logs: readonly LogEntry[]): Map<string, string> {
  const sorted = [...logs].sort(
    (a, b) => parseInt(a.event_sequence, 10) - parseInt(b.event_sequence, 10),
  );
  const requestBodies = sorted.filter((l) => l.event_name === 'api_request_body' && l.body != null);
  const responseBodies = sorted.filter(
    (l) => l.event_name === 'api_response_body' && l.request_id != null,
  );
  const index = new Map<string, string>();
  for (let i = 0; i < requestBodies.length && i < responseBodies.length; i++) {
    const reqId = responseBodies[i]?.request_id;
    const body = requestBodies[i]?.body;
    if (reqId != null && body != null) index.set(reqId, body);
  }
  return index;
}

// ── Tool input lookup ─────────────────────────────────────────────────────────

function buildUseIdToInput(allLogs: readonly LogEntry[]): Map<string, string> {
  const useIdToInput = new Map<string, string>();
  for (const log of allLogs) {
    if (log.tool_use_id != null && log.tool_input != null) {
      useIdToInput.set(log.tool_use_id, log.tool_input);
    }
  }
  return useIdToInput;
}

function resolveToolInput(
  m: SpanMeta,
  logsBySpan: Map<string, LogEntry[]>,
  useIdToInput: Map<string, string>,
): string | null {
  if (m.spanType !== 'tool.blocked_on_user' || m.parentB64 === null) return null;
  const logs = logsBySpan.get(m.id) ?? [];
  const decision = logs.find((l) => l.tool_use_id != null);
  if (decision?.tool_use_id == null) return null;
  return useIdToInput.get(decision.tool_use_id) ?? null;
}

function buildToolInputIndex(
  metas: readonly SpanMeta[],
  allLogs: readonly LogEntry[],
  logsBySpan: Map<string, LogEntry[]>,
): Map<string, string> {
  const useIdToInput = buildUseIdToInput(allLogs);
  const result = new Map<string, string>();
  for (const m of metas) {
    const input = resolveToolInput(m, logsBySpan, useIdToInput);
    if (input == null || m.parentB64 == null) continue;
    const parentId = 's' + b64toHex(m.parentB64);
    result.set(parentId, input);
  }
  return result;
}

function summarizeToolInputPreferred(parsed: Record<string, unknown>, max: number): string | null {
  const useful = parsed.command ?? parsed.file_path ?? parsed.skill ?? parsed.query;
  if (typeof useful === 'string' || typeof useful === 'number' || typeof useful === 'boolean') {
    return String(useful).slice(0, max);
  }
  return null;
}

function firstStringValue(parsed: Record<string, unknown>, max: number): string | null {
  for (const v of Object.values(parsed)) {
    if (typeof v === 'string' && v.length > 0) return v.slice(0, max);
  }
  return null;
}

function summarizeToolInput(json: string, max = 120): string | null {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const preferred = summarizeToolInputPreferred(parsed, max);
    if (preferred != null) return preferred;
    return firstStringValue(parsed, max);
  } catch {
    return json.slice(0, max);
  }
}

// ── Hook span construction ────────────────────────────────────────────────────

interface HookEntry {
  readonly index: number;
  readonly hookName: string;
  readonly startNs: bigint;
  readonly endNs: bigint;
  readonly durationMs: number | null;
}

function buildCompletesByName(sorted: readonly LogEntry[]): Map<string, bigint[]> {
  const completesByName = new Map<string, bigint[]>();
  for (const log of sorted) {
    if (log.event_name !== 'hook_execution_complete' || log.hook_name == null) continue;
    const list = completesByName.get(log.hook_name) ?? [];
    list.push(BigInt(log.timestamp_ns));
    completesByName.set(log.hook_name, list);
  }
  return completesByName;
}

function extractHooks(logs: readonly LogEntry[]): HookEntry[] {
  const sorted = [...logs].sort(
    (a, b) => parseInt(a.event_sequence, 10) - parseInt(b.event_sequence, 10),
  );

  const completesByName = buildCompletesByName(sorted);
  const startCountByName = new Map<string, number>();
  const hooks: HookEntry[] = [];
  let index = 0;

  for (const log of sorted) {
    if (log.event_name !== 'hook_execution_start' || log.hook_name == null) continue;
    const count = startCountByName.get(log.hook_name) ?? 0;
    startCountByName.set(log.hook_name, count + 1);

    const startNs = BigInt(log.timestamp_ns);
    const endNs = completesByName.get(log.hook_name)?.[count] ?? startNs;
    const durationMs = log.total_duration_ms != null ? Number(log.total_duration_ms) || null : null;

    hooks.push({ index: index++, hookName: log.hook_name, startNs, endNs, durationMs });
  }

  return hooks;
}

function parseHookEvent(hookName: string): { event: string; toolName: string | null } {
  const i = hookName.indexOf(':');
  if (i === -1) return { event: hookName, toolName: null };
  return { event: hookName.slice(0, i), toolName: hookName.slice(i + 1) || null };
}

const INTERACTION_LEVEL_HOOKS = new Set([
  'UserPromptSubmit',
  'UserPromptExpansion',
  'Stop',
  'StopFailure',
  'SubagentStop',
  'SubagentStart',
]);

function resolvePreToolParent(
  metas: readonly SpanMeta[],
  toolName: string,
  hook: HookEntry,
): string | null {
  const match = metas
    .filter((m) => m.spanType === 'tool' && m.toolName === toolName && m.startNs >= hook.startNs)
    .sort((a, b) => (a.startNs < b.startNs ? -1 : 1))[0];
  return match?.b64 ?? null;
}

function resolvePostToolParent(
  metas: readonly SpanMeta[],
  toolName: string,
  hook: HookEntry,
): string | null {
  const match = metas
    .filter((m) => m.spanType === 'tool' && m.toolName === toolName && m.endNs <= hook.startNs)
    .sort((a, b) => (a.endNs > b.endNs ? -1 : 1))[0];
  return match?.b64 ?? null;
}

function resolveToolHookParent(
  metas: readonly SpanMeta[],
  event: string,
  toolName: string,
  hook: HookEntry,
): string | null {
  if (event === 'PreToolUse') return resolvePreToolParent(metas, toolName, hook);
  if (event === 'PostToolUse') return resolvePostToolParent(metas, toolName, hook);
  return null;
}

function resolveHookParentB64(metas: readonly SpanMeta[], hook: HookEntry): string | null {
  const { event, toolName } = parseHookEvent(hook.hookName);

  if (toolName != null) return resolveToolHookParent(metas, event, toolName, hook);
  if (INTERACTION_LEVEL_HOOKS.has(event)) {
    return metas.find((m) => m.spanType === 'interaction')?.b64 ?? null;
  }

  return (
    (lastEndedBefore(metas, hook.startNs) ?? narrowestContaining(metas, hook.startNs))?.b64 ?? null
  );
}

// ── Span enrichment ───────────────────────────────────────────────────────────

// Prefer the positional index (reliable even when the log timestamp falls
// outside the span's window); fall back to the attributed log.
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

// ── Public API ────────────────────────────────────────────────────────────────

function getTraceId(trace: TempoTrace): string {
  return allSpansFlat(trace)[0]?.traceId ?? '';
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

export function enrichTrace(trace: TempoTrace, logs: readonly LogEntry[]): TempoTrace {
  const traceId = getTraceId(trace);
  const metas = collectSpanMeta(trace);
  const logsBySpan = attributeLogsToSpans(metas, logs);
  const toolInputBySpanId = buildToolInputIndex(metas, logs, logsBySpan);
  const requestBodyIndex = buildRequestBodyIndex(logs);
  const hooks = extractHooks(logs);

  function enrichScopeSpan(ss: { spans: readonly OtlpSpan[] }) {
    return {
      ...ss,
      spans: ss.spans.map((span) =>
        enrichSpanInBatch(span, metas, logsBySpan, toolInputBySpanId, requestBodyIndex),
      ),
    };
  }

  // Build enriched span batches
  const enrichedBatches: OtlpBatch[] = trace.batches.map((batch) => ({
    ...batch,
    scopeSpans: batch.scopeSpans.map(enrichScopeSpan),
  }));

  // Build hook spans
  const hookSpans: OtlpSpan[] = hooks.map((hook) => {
    const hookB64 = hookSpanB64(hook.index);
    const parentB64 = resolveHookParentB64(metas, hook);

    const span: OtlpSpan = {
      traceId,
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
  });

  if (hookSpans.length === 0) return { batches: enrichedBatches };

  // Append hook spans into the first existing scopeSpan to preserve its scope metadata
  if (enrichedBatches.length === 0) return { batches: [] };
  const [first, ...rest] = enrichedBatches as [OtlpBatch, ...OtlpBatch[]];
  const [firstScope, ...otherScopes] = first.scopeSpans as [
    { spans: readonly OtlpSpan[] },
    ...{ spans: readonly OtlpSpan[] }[],
  ];
  const enrichedFirst: OtlpBatch = {
    ...first,
    scopeSpans: [{ ...firstScope, spans: [...firstScope.spans, ...hookSpans] }, ...otherScopes],
  };

  return { batches: [enrichedFirst, ...rest] };
}
