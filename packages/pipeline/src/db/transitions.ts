// Adjacent tool-action pairs within an interaction — the `transitions` table.
// For each interaction, its TOOL nodes are ordered by the same `seq` the nodes
// table uses (reused from seq.ts so the ordering is byte-identical), and one row
// is emitted per adjacent pair (i, i+1). This is tool→tool ADJACENCY by time
// order, NOT causality: a row says "this tool ran right after that one", nothing
// about one triggering the other (the causal layer is `causal_edges`).

import type { Action } from '@coach/semantics';
import type { CanonicalNode } from '../types.ts';
import type { ExecutionGraph } from '../graph/types.ts';
import { seqByNodeId } from './seq.ts';

function toolNodesByInteraction(nodes: readonly CanonicalNode[]): Map<string, CanonicalNode[]> {
  const byInteraction = new Map<string, CanonicalNode[]>();
  for (const node of nodes) {
    if (node.type !== 'tool' || node.interactionId == null) continue;
    const group = byInteraction.get(node.interactionId) ?? [];
    group.push(node);
    byInteraction.set(node.interactionId, group);
  }
  return byInteraction;
}

function adjacentPairs(tools: readonly CanonicalNode[]): [CanonicalNode, CanonicalNode][] {
  const pairs: [CanonicalNode, CanonicalNode][] = [];
  let previous: CanonicalNode | undefined;
  for (const tool of tools) {
    if (previous != null) pairs.push([previous, tool]);
    previous = tool;
  }
  return pairs;
}

function transitionRows(
  tools: readonly CanonicalNode[],
  seq: Map<string, number>,
  actions: Readonly<Record<string, Action>>,
): Record<string, unknown>[] {
  const ordered = [...tools].sort((a, b) => (seq.get(a.id) ?? 0) - (seq.get(b.id) ?? 0));
  return adjacentPairs(ordered).map(([from, to]) => ({
    interaction_id: from.interactionId,
    from_seq: seq.get(from.id),
    from_action: actions[from.id] ?? 'other',
    to_action: actions[to.id] ?? 'other',
  }));
}

export function buildTransitions(graph: ExecutionGraph): Record<string, unknown>[] {
  const nodes = Object.values(graph.nodes);
  const seq = seqByNodeId(nodes);
  const byInteraction = toolNodesByInteraction(nodes);
  return [...byInteraction.values()].flatMap((tools) => transitionRows(tools, seq, graph.actions));
}
