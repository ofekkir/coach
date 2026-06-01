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
function summarizeInput(input: unknown, max = 120): string | null {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const preferred = obj.command ?? obj.file_path ?? obj.skill ?? obj.query;
  if (
    preferred != null &&
    (typeof preferred === 'string' ||
      typeof preferred === 'number' ||
      typeof preferred === 'boolean')
  ) {
    return String(preferred).slice(0, max);
  }
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

// ── Public API ────────────────────────────────────────────────────────────────

export function nativeSessionToTrace(jsonl: string): TempoTrace {
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

  if (!sessionId || entries.length === 0) return { batches: [] };

  const tId = traceB64(sessionId);

  const byUuid = new Map<string, NativeEntry>();
  for (const e of entries) {
    if (e.uuid) byUuid.set(e.uuid, e);
  }

  // Human prompt: first user entry with plain string content that isn't a meta entry
  const humanUser = entries.find(
    (e) => e.type === 'user' && !e.isMeta && typeof e.message?.content === 'string',
  );
  if (!humanUser?.uuid || !humanUser.timestamp) return { batches: [] };

  const humanContent = humanUser.message?.content;
  const userPrompt = typeof humanContent === 'string' ? humanContent : '';

  // Interaction span end = turn_duration timestamp, fallback = last assistant timestamp
  const turnDuration = entries.find((e) => e.type === 'system' && e.subtype === 'turn_duration');
  const lastAssistant = entries.findLast((e) => e.type === 'assistant' && e.timestamp);
  const interactionStartNs = isoToNano(humanUser.timestamp);
  const rawEnd = turnDuration?.timestamp
    ? isoToNano(turnDuration.timestamp)
    : lastAssistant?.timestamp
      ? isoToNano(lastAssistant.timestamp)
      : interactionStartNs;
  const interactionEndNs = clampEnd(interactionStartNs, rawEnd);

  const interactionSpanId = spanB64('interaction', humanUser.uuid);
  const interactionSpan: OtlpSpan = {
    traceId: tId,
    spanId: interactionSpanId,
    name: 'claude_code.interaction',
    startTimeUnixNano: interactionStartNs,
    endTimeUnixNano: interactionEndNs,
    attributes: [
      strAttr('span.type', 'interaction'),
      strAttr('user_prompt', userPrompt),
      strAttr('session.id', sessionId),
    ],
  };

  // Group assistant entries by requestId (preserves conversation order)
  const requestGroups = new Map<string, NativeEntry[]>();
  for (const e of entries) {
    if (e.type !== 'assistant' || typeof e.requestId !== 'string' || !e.timestamp) continue;
    const group = requestGroups.get(e.requestId) ?? [];
    group.push(e);
    requestGroups.set(e.requestId, group);
  }

  // Map tool_use_id → user entry that returned the result
  const toolResultUser = new Map<string, NativeEntry>();
  for (const e of entries) {
    if (e.type !== 'user' || !e.timestamp) continue;
    const content = e.message?.content;
    if (content == null || typeof content === 'string') continue;
    for (const block of content) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        toolResultUser.set(block.tool_use_id, e);
      }
    }
  }

  // Walk parentUuid chain to find the nearest user ancestor (skipping attachments)
  function findTriggeringUser(entry: NativeEntry): NativeEntry | null {
    let parentUuid = entry.parentUuid ?? null;
    while (parentUuid != null) {
      const parent = byUuid.get(parentUuid);
      if (!parent) break;
      if (parent.type === 'user') return parent;
      parentUuid = parent.parentUuid ?? null;
    }
    return null;
  }

  const spans: OtlpSpan[] = [interactionSpan];

  for (const [requestId, group] of requestGroups) {
    group.sort((a, b) => ((a.timestamp ?? '') < (b.timestamp ?? '') ? -1 : 1));
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;

    const model = first.message?.model ?? '';
    const stopReason = last.message?.stop_reason ?? '';
    const inputTokens = first.message?.usage?.input_tokens ?? 0;
    const outputTokens = first.message?.usage?.output_tokens ?? 0;

    // Concatenate content blocks from all entries in conversation order
    const allBlocks: ContentBlock[] = [];
    for (const e of group) {
      const c = e.message?.content;
      if (c != null && typeof c !== 'string') {
        for (const block of c) allBlocks.push(block);
      }
    }

    const trigUser = findTriggeringUser(first);
    const rawRequestBody = JSON.stringify({
      messages: [{ role: 'user', content: trigUser?.message?.content ?? null }],
    });
    const rawResponseBody = JSON.stringify({ content: allBlocks, stop_reason: stopReason });

    if (!first.timestamp || !last.timestamp) continue;
    const spanStart = isoToNano(first.timestamp);
    const spanEnd = clampEnd(spanStart, isoToNano(last.timestamp));

    spans.push({
      traceId: tId,
      spanId: spanB64('llm_request', requestId),
      parentSpanId: interactionSpanId,
      name: 'claude_code.llm_request',
      startTimeUnixNano: spanStart,
      endTimeUnixNano: spanEnd,
      attributes: [
        strAttr('span.type', 'llm_request'),
        strAttr('model', model),
        intAttr('input_tokens', inputTokens),
        intAttr('output_tokens', outputTokens),
        strAttr('stop_reason', stopReason),
        strAttr('request_id', requestId),
        strAttr('raw_request_body', rawRequestBody),
        strAttr('raw_response_body', rawResponseBody),
      ],
    });

    // One tool span per tool_use block
    for (const block of allBlocks) {
      if (block.type !== 'tool_use' || typeof block.id !== 'string') continue;

      const entryWithTool = group.find(
        (e) =>
          e.message?.content != null &&
          typeof e.message.content !== 'string' &&
          e.message.content.some((b) => b.type === 'tool_use' && b.id === block.id),
      );
      if (!entryWithTool?.timestamp) continue;

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

      spans.push({
        traceId: tId,
        spanId: spanB64('tool', block.id),
        parentSpanId: interactionSpanId,
        name: 'claude_code.tool',
        startTimeUnixNano: toolStart,
        endTimeUnixNano: toolEnd,
        attributes: toolAttrs,
      });
    }
  }

  return { batches: [{ scopeSpans: [{ spans }] }] };
}
