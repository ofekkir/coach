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
import { sessionEntityId } from '../../types.ts';

import { parseSpans } from './parse.ts';
import type { ParsedSpan } from './parse.ts';
import {
  extractRequestMessages,
  extractResponseMessages,
  extractStopReason,
} from './request-body.ts';

// The id/timing/parent/sessionId fields every span-derived node shares. `sessionId`
// is the FK → Session entity, denormalized onto every node (resolved once per
// trace from the interaction span's session.id).
function nodeBase(
  span: ParsedSpan,
  parent: string | null,
  sessionId: string,
): {
  id: string;
  sessionId: string;
  start_time_ns: string;
  end_time_ns: string;
  duration_ms: number;
  parent?: string;
} {
  return {
    id: span.id,
    sessionId,
    start_time_ns: span.startNs,
    end_time_ns: span.endNs,
    duration_ms: span.durationMs,
    ...parentField(parent),
  };
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

function buildInteractionNode(
  span: ParsedSpan,
  parent: string | null,
  sessionId: string,
): InteractionNode {
  const node: InteractionNode = {
    ...nodeBase(span, parent, sessionId),
    type: 'interaction',
    session_id: require(span.sessionId, span.id, 'session.id'),
    sequence: require(span.sequenceIndex, span.id, 'interaction.sequence'),
    prompt: require(span.userPrompt, span.id, 'user_prompt'),
    user_id: require(span.userId, span.id, 'user.id'),
  };
  if (span.cwd != null) node.cwd = span.cwd;
  if (span.branch != null) node.branch = span.branch;
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

// Cost for an llm_request is ONLY ever the cost the trace itself carries (the
// OTEL/harness path). Native logs usually don't carry one — and we deliberately do
// NOT back-compute an estimate from a model price table: a price-table figure is a
// guess, not what was charged, and once written here it's indistinguishable from a
// real cost. Absent a traced cost, `cost_usd` stays NULL ("unknown"), never 0.
function resolveCost(node: LlmRequestNode, span: ParsedSpan): void {
  if (span.costUsd == null) return;
  const traced = parseFloat(span.costUsd);
  if (!isNaN(traced)) node.cost_usd = traced;
}

function buildLlmRequestNode(
  span: ParsedSpan,
  parent: string | null,
  sessionId: string,
  repair: boolean,
): LlmRequestNode {
  const node: LlmRequestNode = {
    ...nodeBase(span, parent, sessionId),
    type: 'llm_request',
    model: require(span.model, span.id, 'model'),
    tokens_in: require(span.inputTokens, span.id, 'input_tokens'),
    tokens_out: require(span.outputTokens, span.id, 'output_tokens'),
  };
  if (span.querySource != null) node.source = span.querySource;
  if (span.rawRequestBody != null) applyRequestBody(node, span.rawRequestBody, repair);
  if (span.rawResponseBody != null) applyResponseBody(node, span.rawResponseBody);
  resolveCost(node, span);
  return node;
}

function buildToolNode(span: ParsedSpan, parent: string | null, sessionId: string): ToolNode {
  const node: ToolNode = { ...nodeBase(span, parent, sessionId), type: 'tool' };
  if (span.toolName != null) node.name = span.toolName;
  if (span.toolUseId != null) node.tool_use_id = span.toolUseId;
  if (span.toolInputSummary != null) node.tool_input = span.toolInputSummary;
  return node;
}

function buildToolExecutionNode(
  span: ParsedSpan,
  parent: string | null,
  sessionId: string,
): ToolExecutionNode {
  return { ...nodeBase(span, parent, sessionId), type: 'tool.execution' };
}

function buildToolBlockedOnUserNode(
  span: ParsedSpan,
  parent: string | null,
  sessionId: string,
): ToolBlockedOnUserNode {
  return { ...nodeBase(span, parent, sessionId), type: 'tool.blocked_on_user' };
}

function buildHookNode(span: ParsedSpan, parent: string | null, sessionId: string): HookNode {
  return {
    ...nodeBase(span, parent, sessionId),
    type: 'hook',
    name: require(span.hookName, span.id, 'hook.name'),
  };
}

function spanToNode(
  span: ParsedSpan,
  rootId: string | null,
  sessionId: string,
  repair: boolean,
): CanonicalNode {
  const parent = effectiveParent(span, rootId);
  switch (span.spanType) {
    case 'llm_request':
      return buildLlmRequestNode(span, parent, sessionId, repair);
    case 'tool':
      return buildToolNode(span, parent, sessionId);
    case 'tool.execution':
      return buildToolExecutionNode(span, parent, sessionId);
    case 'tool.blocked_on_user':
      return buildToolBlockedOnUserNode(span, parent, sessionId);
    case 'hook':
      return buildHookNode(span, parent, sessionId);
    default:
      return buildInteractionNode(span, parent, sessionId);
  }
}

// The Session entity id every node carries as its `sessionId` FK, resolved once
// from the trace's interaction span (the only span carrying `session.id`). Empty
// when the trace has no session attribute (a degraded input).
function resolveSessionId(spans: readonly ParsedSpan[]): string {
  const harnessSessionId = spans.find((s) => s.sessionId != null)?.sessionId;
  return harnessSessionId != null ? sessionEntityId(harnessSessionId) : '';
}

export function transformTrace(trace: TempoTrace, repair = false): CanonicalNode[] {
  const spans = parseSpans(trace);
  const rootId = spans.find((s) => s.parentId === null)?.id ?? null;
  const sessionId = resolveSessionId(spans);
  return spans.map((s) => spanToNode(s, rootId, sessionId, repair));
}
