import type { GraphNode, LlmRequestNode, ResponseMessage } from '../../types.ts';
import type {
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '../types.ts';
import {
  PLAN_LABEL,
  PREDICT_PROMPT_LABEL,
  SESSION_TITLE_LABEL,
  hasThinking,
  invokePhrase,
  isSessionTitleResponse,
  isSuggestionMode,
  parseToolInput,
  responseText,
  responseToolCall,
  toolPhrases,
} from './derive.ts';

// ════════════════════════════════════════════════════════════════════════════
// Semantic enrichment stage — converts mechanical tool/llm_request nodes into
// semantically-labeled action/inference nodes using an injected LLM callback.
//
// Architecture constraint: this module is pure (no node:* imports). The claude
// subprocess adapter lives in scripts/claude-labeler.ts and is wired up only
// by the e2e script when --enrich is passed.
// ════════════════════════════════════════════════════════════════════════════

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * One node sent to the labeler. The model's only job is to classify the *act* of
 * a genuine final assistant message into an ordered list of short action phrases
 * (`["confirm edit", "suggest next steps"]`). Everything the model is bad at —
 * tool intent (derivable from the input), structural roles (thinking → plan,
 * tool_use → invoke), and harness calls (session-title, suggestion-mode) — is
 * derived deterministically in `planLabels` and never reaches here. `response_text`
 * is the assistant's final message; the model names what it did, never quotes it.
 */
export interface LabelRequest {
  id: string;
  response_text: string;
}

/**
 * Injected async callback that classifies a batch of final-message nodes. Returns
 * a map from node id → ordered list of action phrases. Missing ids fall back to
 * their deterministic prefix or a mechanical label (tool name or model id).
 */
export type LabelBatchFn = (
  requests: readonly LabelRequest[],
) => Promise<Map<string, readonly string[]>>;

// ── Label planning ────────────────────────────────────────────────────────────
// Each node gets a deterministic `prefix` (possibly empty) plus, when it ends in a
// genuine assistant message, a `request` for the model to classify the act. The
// final label is `prefix ++ modelResult`. All derivation lives in derive.ts.

interface LabelPlan {
  requests: LabelRequest[];
  prefixes: Map<string, readonly string[]>;
}

function structuralPrefix(response: readonly ResponseMessage[]): string[] {
  const prefix: string[] = [];
  if (hasThinking(response)) prefix.push(PLAN_LABEL);
  const call = responseToolCall(response);
  if (call != null) prefix.push(invokePhrase(call));
  return prefix;
}

function planLlmRequest(node: ExecutionNode, canonical: LlmRequestNode, plan: LabelPlan): void {
  const response = node.responseMessagesDelta ?? [];
  const respText = responseText(response);
  if (respText != null && isSessionTitleResponse(respText)) {
    plan.prefixes.set(canonical.id, [SESSION_TITLE_LABEL]);
    return;
  }
  if (isSuggestionMode(node.requestMessagesDelta ?? [])) {
    plan.prefixes.set(canonical.id, [PREDICT_PROMPT_LABEL]);
    return;
  }
  const prefix = structuralPrefix(response);
  // Text that precedes a tool call is preamble to the action, not a terminal
  // message — only classify the act when the turn actually ends in text.
  const isTerminalMessage = respText != null && responseToolCall(response) == null;
  if (isTerminalMessage) plan.requests.push({ id: canonical.id, response_text: respText });
  if (prefix.length > 0) plan.prefixes.set(canonical.id, prefix);
  else if (!isTerminalMessage) plan.prefixes.set(canonical.id, mechanicalLabel(canonical));
}

function planNode(node: ExecutionNode, plan: LabelPlan): void {
  const canonical = node.canonical;
  if (canonical.type === 'tool') {
    plan.prefixes.set(
      canonical.id,
      toolPhrases(canonical.name, parseToolInput(canonical.tool_input)),
    );
  } else if (canonical.type === 'llm_request') {
    planLlmRequest(node, canonical, plan);
  }
  for (const child of node.children) planNode(child, plan);
}

function planThread(thread: Thread, plan: LabelPlan): void {
  for (const member of thread.members) planNode(member, plan);
}

function planInteraction(ix: InteractionExecution, plan: LabelPlan): void {
  for (const thread of ix.threads) planThread(thread, plan);
}

function planSession(session: SessionExecution, plan: LabelPlan): void {
  for (const ix of session.interactions) planInteraction(ix, plan);
}

function planLabels(graph: ExecutionGraph): LabelPlan {
  const plan: LabelPlan = { requests: [], prefixes: new Map() };
  if (graph.kind === 'agent') {
    for (const session of graph.data.sessions) planSession(session, plan);
  } else if (graph.kind === 'session') {
    planSession(graph.data, plan);
  } else if (graph.data != null) {
    planInteraction(graph.data, plan);
  }
  return plan;
}

// ── Node conversion ───────────────────────────────────────────────────────────

function mechanicalLabel(node: GraphNode): readonly string[] {
  if (node.type === 'tool') return [node.name ?? 'tool'];
  if (node.type === 'llm_request') return [node.model];
  return [node.type];
}

function convertCanonical(node: GraphNode, what: readonly string[] | undefined): GraphNode {
  const label = what ?? mechanicalLabel(node);
  if (node.type === 'tool') return { ...node, type: 'action', what: label };
  if (node.type === 'llm_request') return { ...node, type: 'inference', what: label };
  return node;
}

function convertNode(node: ExecutionNode, labels: Map<string, readonly string[]>): ExecutionNode {
  return {
    ...node,
    canonical: convertCanonical(node.canonical, labels.get(node.id)),
    children: node.children.map((c) => convertNode(c, labels)),
  };
}

function convertThread(thread: Thread, labels: Map<string, readonly string[]>): Thread {
  return { ...thread, members: thread.members.map((m) => convertNode(m, labels)) };
}

function convertInteraction(
  ix: InteractionExecution,
  labels: Map<string, readonly string[]>,
): InteractionExecution {
  return { ...ix, threads: ix.threads.map((t) => convertThread(t, labels)) };
}

function convertSession(
  session: SessionExecution,
  labels: Map<string, readonly string[]>,
): SessionExecution {
  return {
    ...session,
    interactions: session.interactions.map((ix) => convertInteraction(ix, labels)),
  };
}

function applyLabels(
  graph: ExecutionGraph,
  labels: Map<string, readonly string[]>,
): ExecutionGraph {
  if (graph.kind === 'agent') {
    const data: AgentExecution = {
      root: graph.data.root,
      sessions: graph.data.sessions.map((s) => convertSession(s, labels)),
    };
    return { kind: 'agent', data };
  }
  if (graph.kind === 'session') {
    return { kind: 'session', data: convertSession(graph.data, labels) };
  }
  if (graph.data == null) return graph;
  return { kind: 'interaction', data: convertInteraction(graph.data, labels) };
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Enriches an ExecutionGraph by converting mechanical tool/llm_request nodes
 * into semantically-labeled action/inference nodes.
 *
 * The graph structure (hierarchy, ids, edges) is preserved exactly — only the
 * node payloads change. All other node types pass through unchanged. Each node's
 * final label is its deterministic prefix (tool intent, structural role, harness
 * call) concatenated with the model's act-classification of any final message.
 * Nodes with neither receive a mechanical fallback (tool name or model id).
 */
function mergeLabels(
  prefixes: Map<string, readonly string[]>,
  modelLabels: Map<string, readonly string[]>,
): Map<string, readonly string[]> {
  const ids = new Set([...prefixes.keys(), ...modelLabels.keys()]);
  const merged = new Map<string, readonly string[]>();
  for (const id of ids) {
    const phrases = [...(prefixes.get(id) ?? []), ...(modelLabels.get(id) ?? [])];
    if (phrases.length > 0) merged.set(id, phrases);
  }
  return merged;
}

export async function enrichExecutionGraph(
  graph: ExecutionGraph,
  labelBatch: LabelBatchFn,
): Promise<ExecutionGraph> {
  const plan = planLabels(graph);
  if (plan.requests.length === 0 && plan.prefixes.size === 0) return graph;
  const modelLabels =
    plan.requests.length > 0
      ? await labelBatch(plan.requests)
      : new Map<string, readonly string[]>();
  return applyLabels(graph, mergeLabels(plan.prefixes, modelLabels));
}
