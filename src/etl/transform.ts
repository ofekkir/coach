import { Buffer } from 'node:buffer';
import type { NodeType, OtlpAttribute, TempoTrace, TraceNode } from './types.ts';

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

function extractRequestPrompt(bodyJson: string): string | null {
  try {
    const parsed = JSON.parse(bodyJson) as ReqBody;
    const messages = parsed.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role !== 'user') continue;
      const text = firstText(msg.content);
      if (text) return text.trim();
    }
    return null;
  } catch {
    let lastIdx = -1;
    const re = /"role":"user"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bodyJson)) !== null) lastIdx = m.index;
    if (lastIdx === -1) return null;
    const tm = /"text":"((?:[^"\\]|\\.)+)/.exec(bodyJson.slice(lastIdx));
    if (!tm?.[1]) return null;
    return unescape(tm[1]);
  }
}

function extractResponseText(bodyJson: string): string | null {
  try {
    const parsed = JSON.parse(bodyJson) as ResBody;
    for (const block of parsed.content ?? []) {
      if (block.type === 'text' && block.text) return block.text;
      if (block.type === 'tool_use' && block.name) return `tool_use: ${block.name}`;
      if (block.type === 'thinking' && block.thinking && block.thinking !== '<REDACTED>') {
        return block.thinking;
      }
    }
    return null;
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
  // enriched attributes
  readonly querySource: string | null;
  readonly rawRequestBody: string | null;
  readonly rawResponseBody: string | null;
  readonly costUsd: string | null;
  readonly toolInputSummary: string | null;
  readonly hookName: string | null;
}

// ── OTLP parsing ──────────────────────────────────────────────────────────────

function b64toHex(b64: string): string {
  return Buffer.from(b64, 'base64').toString('hex');
}

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
  const spans: ParsedSpan[] = [];
  for (const batch of trace.batches) {
    for (const ss of batch.scopeSpans) {
      for (const span of ss.spans) {
        const startNsBig = BigInt(span.startTimeUnixNano);
        const endNsBig = BigInt(span.endTimeUnixNano);
        spans.push({
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
          querySource: getStringAttr(span.attributes, 'query_source'),
          rawRequestBody: getStringAttr(span.attributes, 'raw_request_body'),
          rawResponseBody: getStringAttr(span.attributes, 'raw_response_body'),
          costUsd: getStringAttr(span.attributes, 'cost_usd'),
          toolInputSummary: getStringAttr(span.attributes, 'tool_input_summary'),
          hookName: getStringAttr(span.attributes, 'hook.name'),
        });
      }
    }
  }
  spans.sort((a, b) => {
    // keep original sort order stable by id when needed; primary sort by start time is baked in
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return spans;
}

// ── Node building ─────────────────────────────────────────────────────────────

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

  switch (span.spanType) {
    case 'interaction':
      if (span.userPrompt != null) node.prompt = span.userPrompt;
      break;
    case 'llm_request':
      if (span.model != null) node.model = span.model;
      if (span.querySource != null) node.source = span.querySource;
      if (span.rawRequestBody != null) {
        node.raw_request = span.rawRequestBody;
        const prompt = extractRequestPrompt(span.rawRequestBody);
        if (prompt != null) node.request = prompt;
      }
      if (span.rawResponseBody != null) {
        node.raw_response = span.rawResponseBody;
        const text = extractResponseText(span.rawResponseBody);
        if (text != null) node.response = text;
        const stopReason = extractStopReason(span.rawResponseBody);
        if (stopReason != null) node.stop_reason = stopReason;
      }
      if (span.inputTokens != null) node.tokens_in = span.inputTokens;
      if (span.outputTokens != null) node.tokens_out = span.outputTokens;
      if (span.costUsd != null) {
        const n = parseFloat(span.costUsd);
        if (!isNaN(n)) node.cost_usd = n;
      }
      break;
    case 'tool':
      if (span.toolName != null) node.name = span.toolName;
      if (span.toolInputSummary != null) node.tool_input = span.toolInputSummary;
      break;
    case 'hook':
      if (span.hookName != null) node.name = span.hookName;
      break;
  }

  return node;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function transformTrace(trace: TempoTrace): TraceNode[] {
  const spans = parseSpans(trace);
  const rootId = spans.find((s) => s.parentId === null)?.id ?? null;
  return spans.map((s) => spanToNode(s, rootId));
}
