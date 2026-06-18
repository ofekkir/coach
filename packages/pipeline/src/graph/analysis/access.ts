import type { CanonicalNode, NodeType } from '../../types.ts';
import { nodeData, semanticsOf, type ExecutionGraph } from '../types.ts';

/** A reference back into `graph.nodes`. `what` is the stage-6 label when the node
 *  was enriched — the cheap human handle, and the concrete reason analysis runs
 *  over the enriched graph rather than the bare stage-5 skeleton. */
export interface NodeRef {
  readonly id: string;
  readonly type: NodeType;
  readonly what?: readonly string[]; // stage-6 action phrases, when enriched
}

/** Every node belonging to one interaction — a flat filter on the stage-4
 *  `interactionId` FK, no tree walk (the interaction node carries its own id). */
export function interactionNodes(graph: ExecutionGraph, interactionId: string): CanonicalNode[] {
  return Object.values(graph.nodes).filter((n) => n.interactionId === interactionId);
}

/** Builds the curated, by-id reference for a node — type plus its stage-6 phrases. */
export function toNodeRef(graph: ExecutionGraph, id: string): NodeRef {
  const node = nodeData(graph, id);
  const what = semanticsOf(graph, id)?.what;
  return { id, type: node.type, ...(what != null ? { what } : {}) };
}
