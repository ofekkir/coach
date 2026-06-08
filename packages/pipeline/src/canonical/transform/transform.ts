import type {
  TempoTrace,
  CanonicalNode,
  InteractionNode,
  LlmRequestNode,
  ToolNode,
  ToolExecutionNode,
  ToolBlockedOnUserNode,
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

function require<T>(value: T | null, spanId: string, attr: string): T {
  if (value == null) throw new Error(`span ${spanId}: missing required attribute '${attr}'`);
  return value;
}

function buildInteractionNode(span: ParsedSpan, parent: string | null): InteractionNode {
  return {
    id: span.id,
    type: 'interaction',
    ...spanTiming(span),
    ...parentField(parent),
    session_id: require(span.sessionId, span.id, 'session.id'),
    sequence: require(span.sequenceIndex, span.id, 'interaction.sequence'),
    prompt: require(span.userPrompt, span.id, 'user_prompt'),
    user_id: require(span.userId, span.id, 'user.id'),
  };
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
    model: require(span.model, span.id, 'model'),
    tokens_in: require(span.inputTokens, span.id, 'input_tokens'),
    tokens_out: require(span.outputTokens, span.id, 'output_tokens'),
  };
  if (span.querySource != null) node.source = span.querySource;
  if (span.rawRequestBody != null) applyRequestBody(node, span.rawRequestBody, repair);
  if (span.rawResponseBody != null) applyResponseBody(node, span.rawResponseBody);
  if (span.costUsd != null) {
    const n = parseFloat(span.costUsd);
    if (!isNaN(n)) node.cost_usd = n;
  }
  return node;
}

function buildToolNode(span: ParsedSpan, parent: string | null): ToolNode {
  const node: ToolNode = { id: span.id, type: 'tool', ...spanTiming(span), ...parentField(parent) };
  if (span.toolName != null) node.name = span.toolName;
  if (span.toolInputSummary != null) node.tool_input = span.toolInputSummary;
  return node;
}

function buildToolExecutionNode(span: ParsedSpan, parent: string | null): ToolExecutionNode {
  return { id: span.id, type: 'tool.execution', ...spanTiming(span), ...parentField(parent) };
}

function buildToolBlockedOnUserNode(
  span: ParsedSpan,
  parent: string | null,
): ToolBlockedOnUserNode {
  return { id: span.id, type: 'tool.blocked_on_user', ...spanTiming(span), ...parentField(parent) };
}

function buildHookNode(span: ParsedSpan, parent: string | null): HookNode {
  return {
    id: span.id,
    type: 'hook',
    ...spanTiming(span),
    ...parentField(parent),
    name: require(span.hookName, span.id, 'hook.name'),
  };
}

function spanToNode(span: ParsedSpan, rootId: string | null, repair: boolean): CanonicalNode {
  const parent = effectiveParent(span, rootId);
  switch (span.spanType) {
    case 'llm_request':
      return buildLlmRequestNode(span, parent, repair);
    case 'tool':
      return buildToolNode(span, parent);
    case 'tool.execution':
      return buildToolExecutionNode(span, parent);
    case 'tool.blocked_on_user':
      return buildToolBlockedOnUserNode(span, parent);
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
