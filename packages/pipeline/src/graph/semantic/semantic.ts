import type { GraphNode, LlmRequestNode } from '../../types.ts';
import type {
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '../types.ts';
import { actionLabel, type SemanticsConfig } from '@coach/semantics';
import {
  markerLabel,
  parseToolInput,
  responseText,
  responseToolCall,
  structuralPrefix,
} from './derive.ts';
import { toolComment, toolPhrases } from './tool-intent.ts';

// ════════════════════════════════════════════════════════════════════════════
// Semantic enrichment stage — converts mechanical tool/llm_request nodes into
// semantically-labeled action/inference nodes. Fully deterministic: every label
// is derived from the injected SemanticsConfig (tool intent, path conventions,
// structural roles, harness markers). No model is involved.
//
// A genuine terminal assistant message (final text, turn does not end in a tool
// call) is labeled with the generic `respond` act. Classifying that act more
// finely (answer / confirm / suggest …) is what a weak-model labeler did; it was
// removed for now. The `messageActs` vocabulary remains in the ontology, reserved
// for reintroducing it.
//
// Architecture constraint: this module is pure (no node:* imports).
// ════════════════════════════════════════════════════════════════════════════

// The ontology action used to label a genuine terminal assistant message.
const TERMINAL_MESSAGE_ACTION = 'respond';

// ── Label planning ────────────────────────────────────────────────────────────
// Each tool/llm_request node is mapped to its ordered action phrases, entirely
// from config. All derivation lives in derive.ts / tool-intent.ts.

type LabelMap = Map<string, readonly string[]>;

function planLlmRequest(
  node: ExecutionNode,
  canonical: LlmRequestNode,
  labels: LabelMap,
  config: SemanticsConfig,
): void {
  const response = node.responseMessagesDelta ?? [];
  const marker = markerLabel(config, node.requestMessagesDelta ?? [], response);
  if (marker != null) {
    labels.set(canonical.id, marker);
    return;
  }
  const prefix = structuralPrefix(config, response);
  // A terminal message is final text that does not precede a tool call. Text that
  // precedes a tool call is preamble to the action, not a terminal message.
  const isTerminalMessage = responseText(response) != null && responseToolCall(response) == null;
  if (isTerminalMessage) {
    labels.set(canonical.id, [...prefix, actionLabel(config, TERMINAL_MESSAGE_ACTION)]);
    return;
  }
  if (prefix.length > 0) labels.set(canonical.id, prefix);
  else labels.set(canonical.id, mechanicalLabel(canonical));
}

function planNode(node: ExecutionNode, labels: LabelMap, config: SemanticsConfig): void {
  const canonical = node.canonical;
  if (canonical.type === 'tool') {
    labels.set(
      canonical.id,
      toolPhrases(config, canonical.name, parseToolInput(canonical.tool_input)),
    );
  } else if (canonical.type === 'llm_request') {
    planLlmRequest(node, canonical, labels, config);
  }
  for (const child of node.children) planNode(child, labels, config);
}

function planThread(thread: Thread, labels: LabelMap, config: SemanticsConfig): void {
  for (const member of thread.members) planNode(member, labels, config);
}

function planInteraction(
  ix: InteractionExecution,
  labels: LabelMap,
  config: SemanticsConfig,
): void {
  for (const thread of ix.threads) planThread(thread, labels, config);
}

function planSession(session: SessionExecution, labels: LabelMap, config: SemanticsConfig): void {
  for (const ix of session.interactions) planInteraction(ix, labels, config);
}

function planLabels(graph: ExecutionGraph, config: SemanticsConfig): LabelMap {
  const labels: LabelMap = new Map();
  if (graph.kind === 'agent') {
    for (const session of graph.data.sessions) planSession(session, labels, config);
  } else if (graph.kind === 'session') {
    planSession(graph.data, labels, config);
  } else if (graph.data != null) {
    planInteraction(graph.data, labels, config);
  }
  return labels;
}

// ── Node conversion ───────────────────────────────────────────────────────────

function mechanicalLabel(node: GraphNode): readonly string[] {
  if (node.type === 'tool') return [node.name ?? 'tool'];
  if (node.type === 'llm_request') return [node.model];
  return [node.type];
}

function convertCanonical(
  node: GraphNode,
  what: readonly string[] | undefined,
  config: SemanticsConfig,
): GraphNode {
  const label = what ?? mechanicalLabel(node);
  if (node.type === 'tool') {
    const comment = toolComment(config, node.name, parseToolInput(node.tool_input));
    return { ...node, type: 'action', what: label, ...(comment != null ? { comment } : {}) };
  }
  if (node.type === 'llm_request') return { ...node, type: 'inference', what: label };
  return node;
}

function convertNode(
  node: ExecutionNode,
  labels: LabelMap,
  config: SemanticsConfig,
): ExecutionNode {
  return {
    ...node,
    canonical: convertCanonical(node.canonical, labels.get(node.id), config),
    children: node.children.map((c) => convertNode(c, labels, config)),
  };
}

function convertThread(thread: Thread, labels: LabelMap, config: SemanticsConfig): Thread {
  return { ...thread, members: thread.members.map((m) => convertNode(m, labels, config)) };
}

function convertInteraction(
  ix: InteractionExecution,
  labels: LabelMap,
  config: SemanticsConfig,
): InteractionExecution {
  return { ...ix, threads: ix.threads.map((t) => convertThread(t, labels, config)) };
}

function convertSession(
  session: SessionExecution,
  labels: LabelMap,
  config: SemanticsConfig,
): SessionExecution {
  return {
    ...session,
    interactions: session.interactions.map((ix) => convertInteraction(ix, labels, config)),
  };
}

function applyLabels(
  graph: ExecutionGraph,
  labels: LabelMap,
  config: SemanticsConfig,
): ExecutionGraph {
  if (graph.kind === 'agent') {
    const data: AgentExecution = {
      root: graph.data.root,
      sessions: graph.data.sessions.map((s) => convertSession(s, labels, config)),
    };
    return { kind: 'agent', data };
  }
  if (graph.kind === 'session') {
    return { kind: 'session', data: convertSession(graph.data, labels, config) };
  }
  if (graph.data == null) return graph;
  return { kind: 'interaction', data: convertInteraction(graph.data, labels, config) };
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Enriches an ExecutionGraph by converting mechanical tool/llm_request nodes into
 * semantically-labeled action/inference nodes. Pure and deterministic — every
 * label comes from the injected SemanticsConfig.
 *
 * The graph structure (hierarchy, ids, edges) is preserved exactly — only the
 * node payloads change; all other node types pass through unchanged. Returns the
 * same graph reference when there is nothing to label.
 */
export function enrichExecutionGraph(
  graph: ExecutionGraph,
  config: SemanticsConfig,
): ExecutionGraph {
  const labels = planLabels(graph, config);
  if (labels.size === 0) return graph;
  return applyLabels(graph, labels, config);
}
