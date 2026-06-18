import type { CanonicalNode } from '../../types.ts';
import { type ExecutionGraph } from '../types.ts';

/** Every node belonging to one interaction — a flat filter on the stage-4
 *  `interactionId` FK, no tree walk (the interaction node carries its own id). */
export function interactionNodes(graph: ExecutionGraph, interactionId: string): CanonicalNode[] {
  return Object.values(graph.nodes).filter((n) => n.interactionId === interactionId);
}
