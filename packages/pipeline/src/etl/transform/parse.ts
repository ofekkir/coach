import type { NodeType, OtlpAttribute, TempoTrace } from '../types.ts';

export interface ParsedSpan {
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
  readonly querySource: string | null;
  readonly rawRequestBody: string | null;
  readonly rawResponseBody: string | null;
  readonly costUsd: string | null;
  readonly toolInputSummary: string | null;
  readonly hookName: string | null;
}

function b64toHex(b64: string): string {
  return Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
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

export function isNodeType(s: string): s is NodeType {
  return (
    s === 'interaction' ||
    s === 'llm_request' ||
    s === 'tool' ||
    s === 'tool.blocked_on_user' ||
    s === 'tool.execution' ||
    s === 'hook'
  );
}

export function parseSpans(trace: TempoTrace): ParsedSpan[] {
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
  spans.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return spans;
}
