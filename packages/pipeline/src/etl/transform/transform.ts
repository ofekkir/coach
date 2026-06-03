import type { TempoTrace, TraceNode } from '../types.ts';
import { extractRequestPrompt, extractResponseText, extractStopReason } from './request-body.ts';
import { isNodeType, parseSpans } from './parse.ts';
import type { ParsedSpan } from './parse.ts';

function applyInteractionFields(node: TraceNode, span: ParsedSpan): void {
  if (span.sequenceIndex != null) node.sequence = span.sequenceIndex;
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

export function transformTrace(trace: TempoTrace): TraceNode[] {
  const spans = parseSpans(trace);
  const rootId = spans.find((s) => s.parentId === null)?.id ?? null;
  return spans.map((s) => spanToNode(s, rootId));
}
