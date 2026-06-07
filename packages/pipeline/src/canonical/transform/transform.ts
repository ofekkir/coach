import type { TempoTrace, CanonicalNode } from '../../types.ts';
import {
  extractRequestMessages,
  extractResponseMessages,
  extractResponseText,
  extractStopReason,
} from './request-body.ts';
import { isNodeType, parseSpans } from './parse.ts';
import type { ParsedSpan } from './parse.ts';

function firstContentText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  for (const b of content as { type?: string; text?: string }[]) {
    if (b.type === 'text' && b.text) return b.text;
  }
  return null;
}

function applyInteractionFields(node: CanonicalNode, span: ParsedSpan): void {
  if (span.sequenceIndex != null) node.sequence = span.sequenceIndex;
  if (span.userPrompt != null) node.prompt = span.userPrompt;
  if (span.sessionId != null) node.session_id = span.sessionId;
  if (span.userId != null) node.user_id = span.userId;
}

function applyRequestBody(node: CanonicalNode, rawRequestBody: string, repair: boolean): void {
  const messages = extractRequestMessages(rawRequestBody, repair);
  if (messages == null) return;
  node.request_messages = messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    const text = firstContentText(msg.content);
    if (text) {
      node.request = text.trim();
      break;
    }
  }
}

function applyResponseBody(node: CanonicalNode, rawResponseBody: string): void {
  const messages = extractResponseMessages(rawResponseBody);
  if (messages != null) node.response_messages = messages;
  const text = extractResponseText(rawResponseBody);
  if (text != null) node.response = text;
  const stopReason = extractStopReason(rawResponseBody);
  if (stopReason != null) node.stop_reason = stopReason;
}

function applyLlmRequestFields(node: CanonicalNode, span: ParsedSpan, repair: boolean): void {
  if (span.model != null) node.model = span.model;
  if (span.querySource != null) node.source = span.querySource;
  if (span.rawRequestBody != null) applyRequestBody(node, span.rawRequestBody, repair);
  if (span.rawResponseBody != null) applyResponseBody(node, span.rawResponseBody);
  if (span.inputTokens != null) node.tokens_in = span.inputTokens;
  if (span.outputTokens != null) node.tokens_out = span.outputTokens;
  if (span.costUsd != null) {
    const n = parseFloat(span.costUsd);
    if (!isNaN(n)) node.cost_usd = n;
  }
}

function applySpanTypeFields(node: CanonicalNode, span: ParsedSpan, repair: boolean): void {
  switch (span.spanType) {
    case 'interaction':
      applyInteractionFields(node, span);
      break;
    case 'llm_request':
      applyLlmRequestFields(node, span, repair);
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

function spanToNode(span: ParsedSpan, rootId: string | null, repair: boolean): CanonicalNode {
  const node: CanonicalNode = {
    id: span.id,
    type: isNodeType(span.spanType) ? span.spanType : 'interaction',
    start_time_ns: span.startNs,
    end_time_ns: span.endNs,
    duration_ms: span.durationMs,
  };

  const effectiveParent = span.spanType === 'hook' && rootId !== null ? rootId : span.parentId;
  if (effectiveParent !== null) node.parent = effectiveParent;
  applySpanTypeFields(node, span, repair);

  return node;
}

export function transformTrace(trace: TempoTrace, repair = false): CanonicalNode[] {
  const spans = parseSpans(trace);
  const rootId = spans.find((s) => s.parentId === null)?.id ?? null;
  return spans.map((s) => spanToNode(s, rootId, repair));
}
