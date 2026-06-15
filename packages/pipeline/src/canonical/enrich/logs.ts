import type { LogEntry } from '../../types.ts';
import { b64toHex, narrowestContaining, SPAN_ID_PREFIX } from './id-utils.ts';
import type { SpanMeta } from './id-utils.ts';

export function attributeLogsToSpans(
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
    } else if (childIds.has(SPAN_ID_PREFIX + log.span_id)) {
      target = SPAN_ID_PREFIX + log.span_id;
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

export function buildRequestBodyIndex(logs: readonly LogEntry[]): Map<string, string> {
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

function buildUseIdToInput(allLogs: readonly LogEntry[]): Map<string, string> {
  const useIdToInput = new Map<string, string>();
  for (const log of allLogs) {
    if (log.tool_use_id != null && log.tool_input != null) {
      useIdToInput.set(log.tool_use_id, log.tool_input);
    }
  }
  return useIdToInput;
}

/** What a tool span can be enriched with from its decision log: the harness's
 *  `tool_use_id` (the causal join key) and, when known, the call's input JSON. */
export interface ToolEnrichment {
  readonly useId: string;
  readonly input: string | null;
}

function resolveToolEnrichment(
  m: SpanMeta,
  logsBySpan: Map<string, LogEntry[]>,
  useIdToInput: Map<string, string>,
): ToolEnrichment | null {
  if (m.spanType !== 'tool.blocked_on_user' || m.parentB64 === null) return null;
  const logs = logsBySpan.get(m.id) ?? [];
  const decision = logs.find((l) => l.tool_use_id != null);
  if (decision?.tool_use_id == null) return null;
  return { useId: decision.tool_use_id, input: useIdToInput.get(decision.tool_use_id) ?? null };
}

// Indexes the parent tool span id → its decision-derived enrichment. The
// decision log lives on the `tool.blocked_on_user` gate span; its data belongs to
// the parent `tool` span, so attribution maps onto the parent.
export function buildToolEnrichmentIndex(
  metas: readonly SpanMeta[],
  allLogs: readonly LogEntry[],
  logsBySpan: Map<string, LogEntry[]>,
): Map<string, ToolEnrichment> {
  const useIdToInput = buildUseIdToInput(allLogs);
  const result = new Map<string, ToolEnrichment>();
  for (const m of metas) {
    const enrichment = resolveToolEnrichment(m, logsBySpan, useIdToInput);
    if (enrichment == null || m.parentB64 == null) continue;
    const parentId = SPAN_ID_PREFIX + b64toHex(m.parentB64);
    result.set(parentId, enrichment);
  }
  return result;
}
