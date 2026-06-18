import type { CanonicalNode, NodeType } from '../../types.ts';
import { nodeData, semanticsOf, type ExecutionGraph, type ExecutionNode } from '../types.ts';

/** A reference back into `graph.nodes`. `what` is the stage-6 label when the node
 *  was enriched — the cheap human handle, and the concrete reason findings runs
 *  over the enriched graph rather than the bare stage-5 skeleton. */
export interface NodeRef {
  readonly id: string;
  readonly type: NodeType;
  readonly what?: readonly string[]; // stage-6 action phrases, when enriched
}

/** The node's wall-clock in ms, or 0 for the synthesized prompt node (no span). */
export function durationMs(node: CanonicalNode): number {
  return 'duration_ms' in node ? node.duration_ms : 0;
}

/** Every node id contained by a containment (sub)tree, parent before children. */
export function collectTreeIds(root: ExecutionNode): string[] {
  const ids: string[] = [];
  const stack: ExecutionNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node == null) break;
    ids.push(node.id);
    for (const child of [...node.children].reverse()) stack.push(child);
  }
  return ids;
}

/** Builds the curated, by-id reference for a node — type plus its stage-6 phrases. */
export function toNodeRef(graph: ExecutionGraph, id: string): NodeRef {
  const node = nodeData(graph, id);
  const what = semanticsOf(graph, id)?.what;
  return { id, type: node.type, ...(what != null ? { what } : {}) };
}
