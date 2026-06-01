import type { NodeType, OtlpAttribute, TempoTrace, TraceNode } from './types.ts';

// ── Base64 / hex helpers (no node:buffer — browser-compatible) ────────────────

function b64toHex(b64: string): string {
  return Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

// ── Raw body extraction ───────────────────────────────────────────────────────

interface ReqBody {
  messages?: { role: string; content: string | { type: string; text?: string }[] }[];
}

interface ResBody {
  content?: { type: string; text?: string; thinking?: string; name?: string }[];
  stop_reason?: string;
}

function firstText(content: string | { type: string; text?: string }[]): string | null {
  if (typeof content === 'string') return content;
  for (const b of content) {
    if (b.type === 'text' && b.text) return b.text;
  }
  return null;
}

function unescape(s: string): string {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function lastUserTextFromParsed(messages: ReqBody['messages']): string | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    const text = firstText(msg.content);
    if (text) return text.trim();
  }
  return null;
}

function lastUserTextFromRaw(bodyJson: string): string | null {
  let lastIdx = -1;
  const re = /"role":"user"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyJson)) !== null) lastIdx = m.index;
  if (lastIdx === -1) return null;
  const tm = /"text":"((?:[^"\\]|\\.)+)/.exec(bodyJson.slice(lastIdx));
  if (!tm?.[1]) return null;
  return unescape(tm[1]);
}

function extractRequestPrompt(bodyJson: string): string | null {
  try {
    const parsed = JSON.parse(bodyJson) as ReqBody;
    return lastUserTextFromParsed(parsed.messages);
  } catch {
    return lastUserTextFromRaw(bodyJson);
  }
}

function extractResponseTextFromBlock(block: {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
}): string | null {
  if (block.type === 'text' && block.text) return block.text;
  if (block.type === 'tool_use' && block.name) return `tool_use: ${block.name}`;
  if (block.type === 'thinking' && block.thinking && block.thinking !== '<REDACTED>') {
    return block.thinking;
  }
  return null;
}

function firstBlockText(content: ResBody['content']): string | null {
  for (const block of content ?? []) {
    const text = extractResponseTextFromBlock(block);
    if (text != null) return text;
  }
  return null;
}

function extractResponseText(bodyJson: string): string | null {
  try {
    const parsed = JSON.parse(bodyJson) as ResBody;
    return firstBlockText(parsed.content);
  } catch {
    return null;
  }
}

function extractStopReason(bodyJson: string): string | null {
  try {
    const parsed = JSON.parse(bodyJson) as ResBody;
    return parsed.stop_reason ?? null;
  } catch {
    return null;
  }
}

// ── Internal span representation ──────────────────────────────────────────────

interface ParsedSpan {
  readonly id: string;
  readonly parentId: string | null;
  readonly startNs: string;
  readonly endNs: string;
  readonly durationMs: number;
  readonly spanType: string;
  readonly model: string | null;
  readonly toolName: string | null;
  readonly userPrompt: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly sessionId: string | null;
  readonly userId: string | null;
  // enriched attributes
  readonly querySource: string | null;
  readonly rawRequestBody: string | null;
  readonly rawResponseBody: string | null;
  readonly costUsd: string | null;
  readonly toolInputSummary: string | null;
  readonly hookName: string | null;
}

// ── OTLP parsing ──────────────────────────────────────────────────────────────

function getStringAttr(attrs: readonly OtlpAttribute[], key: string): string | null {
  const a = attrs.find((x) => x.key === key);
  if (!a) return null;
  return 'stringValue' in a.value ? a.value.stringValue : null;
}

function getIntAttr(attrs: readonly OtlpAttribute[], key: string): number | null {
  const a = attrs.find((x) => x.key === key);
  if (!a) return null;
  if ('intValue' in a.value) return parseInt(a.value.intValue, 10);
  if ('stringValue' in a.value) {
    const n = parseInt(a.value.stringValue, 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

function isNodeType(s: string): s is NodeType {
  return (
    s === 'interaction' ||
    s === 'llm_request' ||
    s === 'tool' ||
    s === 'tool.blocked_on_user' ||
    s === 'tool.execution' ||
    s === 'hook'
  );
}

function parseSpans(trace: TempoTrace): ParsedSpan[] {
  const spans = trace.batches
    .flatMap((batch) => batch.scopeSpans.flatMap((ss) => ss.spans))
    .map((span) => {
      const startNsBig = BigInt(span.startTimeUnixNano);
      const endNsBig = BigInt(span.endTimeUnixNano);
      return {
        id: 's' + b64toHex(span.spanId),
        parentId: span.parentSpanId ? 's' + b64toHex(span.parentSpanId) : null,
        startNs: span.startTimeUnixNano,
        endNs: span.endTimeUnixNano,
        durationMs: Number(endNsBig - startNsBig) / 1_000_000,
        spanType: getStringAttr(span.attributes, 'span.type') ?? span.name,
        model: getStringAttr(span.attributes, 'model'),
        toolName: getStringAttr(span.attributes, 'tool_name'),
        userPrompt: getStringAttr(span.attributes, 'user_prompt'),
        inputTokens: getIntAttr(span.attributes, 'input_tokens'),
        outputTokens: getIntAttr(span.attributes, 'output_tokens'),
        sessionId: getStringAttr(span.attributes, 'session.id'),
        userId: getStringAttr(span.attributes, 'user.id'),
        querySource: getStringAttr(span.attributes, 'query_source'),
        rawRequestBody: getStringAttr(span.attributes, 'raw_request_body'),
        rawResponseBody: getStringAttr(span.attributes, 'raw_response_body'),
        costUsd: getStringAttr(span.attributes, 'cost_usd'),
        toolInputSummary: getStringAttr(span.attributes, 'tool_input_summary'),
        hookName: getStringAttr(span.attributes, 'hook.name'),
      };
    });
  spans.sort((a, b) => {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return spans;
}

// ── Node building ─────────────────────────────────────────────────────────────

function applyInteractionFields(node: TraceNode, span: ParsedSpan): void {
  if (span.userPrompt != null) node.prompt = span.userPrompt;
  if (span.sessionId != null) node.session_id = span.sessionId;
  if (span.userId != null) node.user_id = span.userId;
}

function applyRequestBody(node: TraceNode, rawRequestBody: string): void {
  node.raw_request = rawRequestBody;
  const prompt = extractRequestPrompt(rawRequestBody);
  if (prompt != null) node.request = prompt;
}

function applyResponseBody(node: TraceNode, rawResponseBody: string): void {
  node.raw_response = rawResponseBody;
  const text = extractResponseText(rawResponseBody);
  if (text != null) node.response = text;
  const stopReason = extractStopReason(rawResponseBody);
  if (stopReason != null) node.stop_reason = stopReason;
}

function applyLlmRequestFields(node: TraceNode, span: ParsedSpan): void {
  if (span.model != null) node.model = span.model;
  if (span.querySource != null) node.source = span.querySource;
  if (span.rawRequestBody != null) applyRequestBody(node, span.rawRequestBody);
  if (span.rawResponseBody != null) applyResponseBody(node, span.rawResponseBody);
  if (span.inputTokens != null) node.tokens_in = span.inputTokens;
  if (span.outputTokens != null) node.tokens_out = span.outputTokens;
  if (span.costUsd != null) {
    const n = parseFloat(span.costUsd);
    if (!isNaN(n)) node.cost_usd = n;
  }
}

function applySpanTypeFields(node: TraceNode, span: ParsedSpan): void {
  switch (span.spanType) {
    case 'interaction':
      applyInteractionFields(node, span);
      break;
    case 'llm_request':
      applyLlmRequestFields(node, span);
      break;
    case 'tool':
      if (span.toolName != null) node.name = span.toolName;
      if (span.toolInputSummary != null) node.tool_input = span.toolInputSummary;
      break;
    case 'hook':
      if (span.hookName != null) node.name = span.hookName;
      break;
  }
}

function spanToNode(span: ParsedSpan, rootId: string | null): TraceNode {
  const node: TraceNode = {
    id: span.id,
    type: isNodeType(span.spanType) ? span.spanType : 'interaction',
    start_time_ns: span.startNs,
    end_time_ns: span.endNs,
    duration_ms: span.durationMs,
  };

  const effectiveParent = span.spanType === 'hook' && rootId !== null ? rootId : span.parentId;
  if (effectiveParent !== null) node.parent = effectiveParent;
  applySpanTypeFields(node, span);

  return node;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function transformTrace(trace: TempoTrace): TraceNode[] {
  const spans = parseSpans(trace);
  const rootId = spans.find((s) => s.parentId === null)?.id ?? null;
  return spans.map((s) => spanToNode(s, rootId));
}
