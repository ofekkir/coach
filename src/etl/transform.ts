import { Buffer } from 'node:buffer';
import type { NodeType, OtlpAttribute, TempoTrace, TraceNode } from './types.ts';

// ── Internal span representation ──────────────────────────────────────────────

interface ParsedSpan {
  readonly id: string;
  readonly parentId: string | null;
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
  readonly requestPrompt: string | null;
  readonly rawResponseBody: string | null;
  readonly responseText: string | null;
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
        const startNs = BigInt(span.startTimeUnixNano);
        const endNs = BigInt(span.endTimeUnixNano);
        spans.push({
          id: 's' + b64toHex(span.spanId),
          parentId: span.parentSpanId ? 's' + b64toHex(span.parentSpanId) : null,
          durationMs: Number(endNs - startNs) / 1_000_000,
          spanType: getStringAttr(span.attributes, 'span.type') ?? span.name,
          model: getStringAttr(span.attributes, 'model'),
          toolName: getStringAttr(span.attributes, 'tool_name'),
          userPrompt: getStringAttr(span.attributes, 'user_prompt'),
          inputTokens: getIntAttr(span.attributes, 'input_tokens'),
          outputTokens: getIntAttr(span.attributes, 'output_tokens'),
          querySource: getStringAttr(span.attributes, 'query_source'),
          rawRequestBody: getStringAttr(span.attributes, 'raw_request_body'),
          requestPrompt: getStringAttr(span.attributes, 'request_prompt'),
          rawResponseBody: getStringAttr(span.attributes, 'raw_response_body'),
          responseText: getStringAttr(span.attributes, 'response_text'),
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

function spanToNode(span: ParsedSpan): TraceNode {
  const node: TraceNode = {
    id: span.id,
    type: isNodeType(span.spanType) ? span.spanType : 'interaction',
    duration_ms: span.durationMs,
  };

  if (span.parentId !== null) node.parent = span.parentId;

  switch (span.spanType) {
    case 'interaction':
      if (span.userPrompt != null) node.prompt = span.userPrompt;
      break;
    case 'llm_request':
      if (span.model != null) node.model = span.model;
      if (span.querySource != null) node.source = span.querySource;
      if (span.rawRequestBody != null) node.raw_request = span.rawRequestBody;
      if (span.requestPrompt != null) node.request = span.requestPrompt;
      if (span.rawResponseBody != null) node.raw_response = span.rawResponseBody;
      if (span.responseText != null) node.response = span.responseText;
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
  return parseSpans(trace).map(spanToNode);
}
