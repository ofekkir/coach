import type {
  TempoTrace,
  CanonicalNode,
  InteractionNode,
  LlmRequestNode,
  ToolNode,
  ToolType,
  HookNode,
} from '../../types.ts';
import {
  extractRequestMessages,
  extractResponseMessages,
  extractStopReason,
} from './request-body.ts';
import { parseSpans } from './parse.ts';
import type { ParsedSpan } from './parse.ts';

function spanTiming(span: ParsedSpan): {
  start_time_ns: string;
  end_time_ns: string;
  duration_ms: number;
} {
  return { start_time_ns: span.startNs, end_time_ns: span.endNs, duration_ms: span.durationMs };
}

function effectiveParent(span: ParsedSpan, rootId: string | null): string | null {
  if (span.spanType === 'hook' && rootId !== null) return rootId;
  return span.parentId;
}

function parentField(parent: string | null): { parent?: string } {
  return parent !== null ? { parent } : {};
}

function buildInteractionNode(span: ParsedSpan, parent: string | null): InteractionNode {
  const node: InteractionNode = {
    id: span.id,
    type: 'interaction',
    ...spanTiming(span),
    ...parentField(parent),
  };
  if (span.sequenceIndex != null) node.sequence = span.sequenceIndex;
  if (span.userPrompt != null) node.prompt = span.userPrompt;
  if (span.sessionId != null) node.session_id = span.sessionId;
  if (span.userId != null) node.user_id = span.userId;
  return node;
}

function applyRequestBody(node: LlmRequestNode, rawRequestBody: string, repair: boolean): void {
  const messages = extractRequestMessages(rawRequestBody, repair);
  if (messages == null) return;
  node.request_messages = messages;
}

function applyResponseBody(node: LlmRequestNode, rawResponseBody: string): void {
  const messages = extractResponseMessages(rawResponseBody);
  if (messages != null) node.response_messages = messages;
  const stopReason = extractStopReason(rawResponseBody);
  if (stopReason != null) node.stop_reason = stopReason;
}

function buildLlmRequestNode(
  span: ParsedSpan,
  parent: string | null,
  repair: boolean,
): LlmRequestNode {
  const node: LlmRequestNode = {
    id: span.id,
    type: 'llm_request',
    ...spanTiming(span),
    ...parentField(parent),
  };
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
  return node;
}

// One builder for all three tool variants — they share a shape and differ only
// by discriminant. (The previous flat-struct code only handled bare `tool`,
// silently dropping name/tool_input on `tool.execution` and `tool.blocked_on_user`.)
function buildToolNode(span: ParsedSpan, parent: string | null, type: ToolType): ToolNode {
  const node: ToolNode = { id: span.id, type, ...spanTiming(span), ...parentField(parent) };
  if (span.toolName != null) node.name = span.toolName;
  if (span.toolInputSummary != null) node.tool_input = span.toolInputSummary;
  return node;
}

function buildHookNode(span: ParsedSpan, parent: string | null): HookNode {
  const node: HookNode = { id: span.id, type: 'hook', ...spanTiming(span), ...parentField(parent) };
  if (span.hookName != null) node.name = span.hookName;
  return node;
}

function spanToNode(span: ParsedSpan, rootId: string | null, repair: boolean): CanonicalNode {
  const parent = effectiveParent(span, rootId);
  switch (span.spanType) {
    case 'llm_request':
      return buildLlmRequestNode(span, parent, repair);
    case 'tool':
      return buildToolNode(span, parent, 'tool');
    case 'tool.execution':
      return buildToolNode(span, parent, 'tool.execution');
    case 'tool.blocked_on_user':
      return buildToolNode(span, parent, 'tool.blocked_on_user');
    case 'hook':
      return buildHookNode(span, parent);
    default:
      return buildInteractionNode(span, parent);
  }
}

export function transformTrace(trace: TempoTrace, repair = false): CanonicalNode[] {
  const spans = parseSpans(trace);
  const rootId = spans.find((s) => s.parentId === null)?.id ?? null;
  return spans.map((s) => spanToNode(s, rootId, repair));
}
