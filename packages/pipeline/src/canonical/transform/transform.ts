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
import { costUsd } from '@coach/semantics';
import {
  extractRequestMessages,
  extractResponseMessages,
  extractStopReason,
} from './request-body.ts';
import { parseSpans } from './parse.ts';
import type { ParsedSpan } from './parse.ts';

/** Called with the model id when a present model + tokens cannot be priced (model
 *  absent from the @coach/semantics price table). The pure pipeline never logs
 *  directly (it must run in the browser too); the Node CLI injects a logger-backed
 *  callback. Optional everywhere else. */
export type OnUnknownCostModel = (model: string) => void;

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
  return {
    ...nodeBase(span, parent, sessionId),
    type: 'interaction',
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

// The trace's own cost, when it carries one (the OTEL/harness path). Native logs
// usually don't — `null` means "derive it from model + tokens instead".
function tracedCost(span: ParsedSpan): number | null {
  if (span.costUsd == null) return null;
  const n = parseFloat(span.costUsd);
  return isNaN(n) ? null : n;
}

// Cost for an llm_request: prefer the cost the trace already carries; otherwise
// derive it from model + tokens via the @coach/semantics price table. An unknown
// model derives to NULL (never 0) and reports the model so the caller can log it.
function resolveCost(node: LlmRequestNode, span: ParsedSpan, onUnknown?: OnUnknownCostModel): void {
  const traced = tracedCost(span);
  if (traced != null) {
    node.cost_usd = traced;
    return;
  }
  const derived = costUsd(node.model, node.tokens_in, node.tokens_out);
  if (derived != null) {
    node.cost_usd = derived;
    return;
  }
  onUnknown?.(node.model);
}

function buildLlmRequestNode(
  span: ParsedSpan,
  parent: string | null,
  sessionId: string,
  repair: boolean,
  onUnknownCostModel?: OnUnknownCostModel,
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
  resolveCost(node, span, onUnknownCostModel);
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
  onUnknownCostModel?: OnUnknownCostModel,
): CanonicalNode {
  const parent = effectiveParent(span, rootId);
  switch (span.spanType) {
    case 'llm_request':
      return buildLlmRequestNode(span, parent, sessionId, repair, onUnknownCostModel);
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

export function transformTrace(
  trace: TempoTrace,
  repair = false,
  onUnknownCostModel?: OnUnknownCostModel,
): CanonicalNode[] {
  const spans = parseSpans(trace);
  const rootId = spans.find((s) => s.parentId === null)?.id ?? null;
  const sessionId = resolveSessionId(spans);
  return spans.map((s) => spanToNode(s, rootId, sessionId, repair, onUnknownCostModel));
}
