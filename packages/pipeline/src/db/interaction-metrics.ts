// interaction_metrics — one row per interaction, every value a PURE aggregate over
// the `nodes` of that interaction (grouped by interaction_id). This is a derived
// rollup, not a new source of truth: each column is recomputed here exactly as the
// equivalent SQL would (`COUNT`, `SUM`, seq-ordered first/last), so the equality
// invariant against `nodes` holds by construction. Pure — no node:* imports.
//
// shape: 'agentic' iff the interaction ran at least one tool node, else 'direct'.
// distinct_files: distinct non-NULL file_path among the interaction's tool nodes
//   (the same file_path the `nodes` table promotes via extractFilePath).
// first_action/last_action: the `action` of the first/last tool node by seq.

import type { Action } from '@coach/semantics';
import type { CanonicalNode, ToolNode } from '../types.ts';
import type { ExecutionGraph } from '../graph/types.ts';
import { extractFilePath, parseToolInput } from '../graph/semantic/derive.ts';
import { seqByNodeId } from './seq.ts';

function isToolNode(node: CanonicalNode): node is ToolNode {
  return node.type === 'tool';
}

function nodesByInteraction(nodes: readonly CanonicalNode[]): Map<string, CanonicalNode[]> {
  const groups = new Map<string, CanonicalNode[]>();
  for (const node of nodes) {
    if (node.interactionId == null) continue;
    const group = groups.get(node.interactionId) ?? [];
    group.push(node);
    groups.set(node.interactionId, group);
  }
  return groups;
}

function sumTokens(llmNodes: readonly CanonicalNode[], field: 'tokens_in' | 'tokens_out'): number {
  return llmNodes.reduce(
    (total, node) => total + (node.type === 'llm_request' ? node[field] : 0),
    0,
  );
}

function sumCost(llmNodes: readonly CanonicalNode[]): number {
  return llmNodes.reduce(
    (total, node) => total + (node.type === 'llm_request' ? (node.cost_usd ?? 0) : 0),
    0,
  );
}

function distinctFileCount(toolNodes: readonly ToolNode[]): number {
  const paths = toolNodes
    .map((node) => extractFilePath(parseToolInput(node.tool_input)))
    .filter((path): path is string => path != null);
  return new Set(paths).size;
}

function toolActionsBySeq(
  toolNodes: readonly ToolNode[],
  actions: Readonly<Record<string, Action>>,
  seq: Map<string, number>,
): (Action | undefined)[] {
  return [...toolNodes]
    .sort((a, b) => (seq.get(a.id) ?? 0) - (seq.get(b.id) ?? 0))
    .map((node) => actions[node.id] ?? 'other');
}

function metricsRecord(
  interactionId: string,
  nodes: readonly CanonicalNode[],
  actions: Readonly<Record<string, Action>>,
  seq: Map<string, number>,
): Record<string, unknown> {
  const interaction = nodes.find((node) => node.type === 'interaction');
  const toolNodes = nodes.filter(isToolNode);
  const llmNodes = nodes.filter((node) => node.type === 'llm_request');
  const orderedActions = toolActionsBySeq(toolNodes, actions, seq);
  return {
    interaction_id: interactionId,
    session_id: interaction?.sessionId,
    sequence: interaction?.type === 'interaction' ? interaction.sequence : undefined,
    prompt_len: interaction?.type === 'interaction' ? interaction.prompt.length : undefined,
    tool_count: toolNodes.length,
    llm_count: llmNodes.length,
    tokens_in: sumTokens(llmNodes, 'tokens_in'),
    tokens_out: sumTokens(llmNodes, 'tokens_out'),
    cost_usd: sumCost(llmNodes),
    duration_ms: interaction?.duration_ms,
    shape: toolNodes.length > 0 ? 'agentic' : 'direct',
    first_action: orderedActions[0],
    last_action: orderedActions[orderedActions.length - 1],
    distinct_files: distinctFileCount(toolNodes),
    error_count: toolNodes.filter((node) => node.is_error === true).length,
  };
}

/** One row per interaction; every value a pure aggregate over that interaction's `nodes`. */
export function buildInteractionMetrics(graph: ExecutionGraph): Record<string, unknown>[] {
  const allNodes = Object.values(graph.nodes);
  const seq = seqByNodeId(allNodes);
  return [...nodesByInteraction(allNodes)].map(([interactionId, nodes]) =>
    metricsRecord(interactionId, nodes, graph.actions, seq),
  );
}
