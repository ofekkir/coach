import type { OtlpAttribute, OtlpSpan, TempoTrace } from './types.ts';

// ── Browser-compatible ID helpers (no node:crypto) ────────────────────────────

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

function spanB64(kind: string, id: string): string {
  return uint8ToBase64(deterministicBytes(`${kind}:${id}`, 8));
}

function traceB64(sessionId: string): string {
  return uint8ToBase64(deterministicBytes(sessionId, 16));
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────

function isoToNano(iso: string): string {
  return String(BigInt(Date.parse(iso)) * 1_000_000n);
}

function clampEnd(start: string, end: string): string {
  return BigInt(end) >= BigInt(start) ? end : start;
}

// ── Attribute helpers ─────────────────────────────────────────────────────────

function strAttr(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function intAttr(key: string, value: number): OtlpAttribute {
  return { key, value: { intValue: String(value) } };
}

// Mirrors the logic in enrich.ts summarizeToolInput but takes a parsed object
function summarizeInputPreferred(obj: Record<string, unknown>, max: number): string | null {
  const preferred = obj.command ?? obj.file_path ?? obj.skill ?? obj.query;
  if (preferred == null) return null;
  if (
    typeof preferred === 'string' ||
    typeof preferred === 'number' ||
    typeof preferred === 'boolean'
  ) {
    return String(preferred).slice(0, max);
  }
  return null;
}

function summarizeInput(input: unknown, max = 120): string | null {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const preferred = summarizeInputPreferred(obj, max);
  if (preferred != null) return preferred;
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.length > 0) return v.slice(0, max);
  }
  return null;
}

// ── Native entry types ────────────────────────────────────────────────────────

interface ContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly thinking?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly tool_use_id?: string;
}

interface NativeMessage {
  readonly model?: string;
  readonly content?: string | readonly ContentBlock[];
  readonly stop_reason?: string;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
}

interface NativeEntry {
  readonly uuid?: string;
  readonly parentUuid?: string | null;
  readonly type?: string;
  readonly subtype?: string;
  readonly timestamp?: string;
  readonly sessionId?: string;
  readonly isMeta?: boolean;
  readonly message?: NativeMessage;
  readonly requestId?: string;
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

function parseEntries(jsonl: string): { sessionId: string; entries: NativeEntry[] } {
  let sessionId = '';
  const entries: NativeEntry[] = [];

  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: NativeEntry;
    try {
      obj = JSON.parse(trimmed) as NativeEntry;
    } catch {
      continue;
    }
    if (typeof obj.sessionId === 'string' && !sessionId) sessionId = obj.sessionId;
    if (typeof obj.uuid === 'string') entries.push(obj);
  }

  return { sessionId, entries };
}

function indexToolResultBlocks(e: NativeEntry, index: Map<string, NativeEntry>): void {
  const content = e.message?.content;
  if (content == null || typeof content === 'string') return;
  for (const block of content) {
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      index.set(block.tool_use_id, e);
    }
  }
}

function buildToolResultUserIndex(entries: NativeEntry[]): Map<string, NativeEntry> {
  const toolResultUser = new Map<string, NativeEntry>();
  for (const e of entries) {
    if (e.type !== 'user' || !e.timestamp) continue;
    indexToolResultBlocks(e, toolResultUser);
  }
  return toolResultUser;
}

function buildRequestGroups(entries: NativeEntry[]): Map<string, NativeEntry[]> {
  const requestGroups = new Map<string, NativeEntry[]>();
  for (const e of entries) {
    if (e.type !== 'assistant' || typeof e.requestId !== 'string' || !e.timestamp) continue;
    const group = requestGroups.get(e.requestId) ?? [];
    group.push(e);
    requestGroups.set(e.requestId, group);
  }
  return requestGroups;
}

function entryBlocks(e: NativeEntry): readonly ContentBlock[] {
  const c = e.message?.content;
  if (c == null || typeof c === 'string') return [];
  return c;
}

function collectContentBlocks(group: NativeEntry[]): ContentBlock[] {
  return group.flatMap(entryBlocks);
}

function findEntryWithBlock(group: NativeEntry[], blockId: string): NativeEntry | undefined {
  return group.find((e) => {
    const content = e.message?.content;
    if (content == null || typeof content === 'string') return false;
    return content.some((b) => b.type === 'tool_use' && b.id === blockId);
  });
}

interface LlmSpanMeta {
  model: string;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  spanStart: string;
  spanEnd: string;
}

function extractLlmGroupBounds(
  group: NativeEntry[],
): {
  first: NativeEntry & { timestamp: string };
  last: NativeEntry & { timestamp: string };
} | null {
  const first = group[0];
  const last = group[group.length - 1];
  if (!first?.timestamp || !last?.timestamp) return null;
  return {
    first: first as NativeEntry & { timestamp: string },
    last: last as NativeEntry & { timestamp: string },
  };
}

function extractFirstMessageFields(msg: NativeMessage | undefined): {
  model: string;
  inputTokens: number;
  outputTokens: number;
} {
  return {
    model: msg?.model ?? '',
    inputTokens: msg?.usage?.input_tokens ?? 0,
    outputTokens: msg?.usage?.output_tokens ?? 0,
  };
}

function extractTokenUsage(
  first: NativeEntry,
  last: NativeEntry,
): { model: string; stopReason: string; inputTokens: number; outputTokens: number } {
  const fromFirst = extractFirstMessageFields(first.message);
  return {
    ...fromFirst,
    stopReason: last.message?.stop_reason ?? '',
  };
}

function extractLlmSpanMeta(group: NativeEntry[]): LlmSpanMeta | null {
  const bounds = extractLlmGroupBounds(group);
  if (bounds == null) return null;
  const { first, last } = bounds;
  const spanStart = isoToNano(first.timestamp);
  const usage = extractTokenUsage(first, last);
  return {
    ...usage,
    spanStart,
    spanEnd: clampEnd(spanStart, isoToNano(last.timestamp)),
  };
}

function buildLlmSpan(
  tId: string,
  requestId: string,
  group: NativeEntry[],
  allBlocks: ContentBlock[],
  interactionSpanId: string,
  trigUser: NativeEntry | null,
): OtlpSpan | null {
  const meta = extractLlmSpanMeta(group);
  if (meta == null) return null;

  const rawRequestBody = JSON.stringify({
    messages: [{ role: 'user', content: trigUser?.message?.content ?? null }],
  });
  const rawResponseBody = JSON.stringify({ content: allBlocks, stop_reason: meta.stopReason });

  return {
    traceId: tId,
    spanId: spanB64('llm_request', requestId),
    parentSpanId: interactionSpanId,
    name: 'claude_code.llm_request',
    startTimeUnixNano: meta.spanStart,
    endTimeUnixNano: meta.spanEnd,
    attributes: [
      strAttr('span.type', 'llm_request'),
      strAttr('model', meta.model),
      intAttr('input_tokens', meta.inputTokens),
      intAttr('output_tokens', meta.outputTokens),
      strAttr('stop_reason', meta.stopReason),
      strAttr('request_id', requestId),
      strAttr('raw_request_body', rawRequestBody),
      strAttr('raw_response_body', rawResponseBody),
    ],
  };
}

function buildToolSpan(
  tId: string,
  block: ContentBlock,
  group: NativeEntry[],
  toolResultUser: Map<string, NativeEntry>,
  interactionSpanId: string,
): OtlpSpan | null {
  if (block.type !== 'tool_use' || typeof block.id !== 'string') return null;

  const entryWithTool = findEntryWithBlock(group, block.id);
  if (!entryWithTool?.timestamp) return null;

  const toolStart = isoToNano(entryWithTool.timestamp);
  const resultEntry = toolResultUser.get(block.id);
  const toolEnd = clampEnd(
    toolStart,
    resultEntry?.timestamp ? isoToNano(resultEntry.timestamp) : toolStart,
  );

  const summary = summarizeInput(block.input);
  const toolAttrs: OtlpAttribute[] = [
    strAttr('span.type', 'tool'),
    strAttr('tool_name', block.name ?? 'unknown'),
  ];
  if (summary != null) toolAttrs.push(strAttr('tool_input_summary', summary));

  return {
    traceId: tId,
    spanId: spanB64('tool', block.id),
    parentSpanId: interactionSpanId,
    name: 'claude_code.tool',
    startTimeUnixNano: toolStart,
    endTimeUnixNano: toolEnd,
    attributes: toolAttrs,
  };
}

// Walk parentUuid chain to find the nearest user ancestor (skipping attachments)
function findTriggeringUser(
  entry: NativeEntry,
  byUuid: Map<string, NativeEntry>,
): NativeEntry | null {
  let parentUuid = entry.parentUuid ?? null;
  while (parentUuid != null) {
    const parent = byUuid.get(parentUuid);
    if (!parent) break;
    if (parent.type === 'user') return parent;
    parentUuid = parent.parentUuid ?? null;
  }
  return null;
}

function buildSpansForRequest(
  tId: string,
  requestId: string,
  group: NativeEntry[],
  byUuid: Map<string, NativeEntry>,
  toolResultUser: Map<string, NativeEntry>,
  interactionSpanId: string,
): OtlpSpan[] {
  group.sort((a, b) => ((a.timestamp ?? '') < (b.timestamp ?? '') ? -1 : 1));
  const first = group[0];
  if (!first) return [];

  const allBlocks = collectContentBlocks(group);
  const trigUser = findTriggeringUser(first, byUuid);

  const llmSpan = buildLlmSpan(tId, requestId, group, allBlocks, interactionSpanId, trigUser);
  if (!llmSpan) return [];

  const toolSpans = allBlocks.flatMap((block) => {
    const span = buildToolSpan(tId, block, group, toolResultUser, interactionSpanId);
    return span != null ? [span] : [];
  });

  return [llmSpan, ...toolSpans];
}

function resolveInteractionEndNs(entries: NativeEntry[], interactionStartNs: string): string {
  const turnDuration = entries.find((e) => e.type === 'system' && e.subtype === 'turn_duration');
  const lastAssistant = entries.findLast((e) => e.type === 'assistant' && e.timestamp);
  const rawEnd = turnDuration?.timestamp
    ? isoToNano(turnDuration.timestamp)
    : lastAssistant?.timestamp
      ? isoToNano(lastAssistant.timestamp)
      : interactionStartNs;
  return clampEnd(interactionStartNs, rawEnd);
}

function buildInteractionSpan(
  tId: string,
  humanUser: NativeEntry & { uuid: string; timestamp: string },
  sessionId: string,
  entries: NativeEntry[],
): { span: OtlpSpan; spanId: string } {
  const humanContent = humanUser.message?.content;
  const userPrompt = typeof humanContent === 'string' ? humanContent : '';
  const interactionStartNs = isoToNano(humanUser.timestamp);
  const interactionEndNs = resolveInteractionEndNs(entries, interactionStartNs);
  const spanId = spanB64('interaction', humanUser.uuid);
  return {
    spanId,
    span: {
      traceId: tId,
      spanId,
      name: 'claude_code.interaction',
      startTimeUnixNano: interactionStartNs,
      endTimeUnixNano: interactionEndNs,
      attributes: [
        strAttr('span.type', 'interaction'),
        strAttr('user_prompt', userPrompt),
        strAttr('session.id', sessionId),
      ],
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function nativeSessionToTrace(jsonl: string): TempoTrace {
  const { sessionId, entries } = parseEntries(jsonl);

  if (!sessionId || entries.length === 0) return { batches: [] };

  const tId = traceB64(sessionId);
  const byUuid = new Map<string, NativeEntry>(
    entries.flatMap((e) => (e.uuid != null ? [[e.uuid, e] as [string, NativeEntry]] : [])),
  );

  // Human prompt: first user entry with plain string content that isn't a meta entry
  const humanUser = entries.find(
    (e) => e.type === 'user' && !e.isMeta && typeof e.message?.content === 'string',
  );
  if (!humanUser?.uuid || !humanUser.timestamp) return { batches: [] };

  const { span: interactionSpan, spanId: interactionSpanId } = buildInteractionSpan(
    tId,
    humanUser as NativeEntry & { uuid: string; timestamp: string },
    sessionId,
    entries,
  );

  const requestGroups = buildRequestGroups(entries);
  const toolResultUser = buildToolResultUserIndex(entries);

  const requestSpans = [...requestGroups.entries()].flatMap(([requestId, group]) =>
    buildSpansForRequest(tId, requestId, group, byUuid, toolResultUser, interactionSpanId),
  );

  return { batches: [{ scopeSpans: [{ spans: [interactionSpan, ...requestSpans] }] }] };
}
