import type { CanonicalNode } from '../../types.ts';
import { nodeData, semanticsOf, type ExecutionGraph, type ExecutionNode } from '../types.ts';
import type { NodeRef } from './types.ts';

/** The node's wall-clock in ms, or 0 for the synthesized prompt node (no span). */
export function durationMs(node: CanonicalNode): number {
  return 'duration_ms' in node ? node.duration_ms : 0;
}

/** Every node id contained by a containment (sub)tree, parent before children. */
export function collectTreeIds(root: ExecutionNode): string[] {
  return [root.id, ...root.children.flatMap(collectTreeIds)];
}

/** Builds the curated, by-id reference for a node — type plus its stage-6 phrases. */
export function toNodeRef(graph: ExecutionGraph, id: string): NodeRef {
  const node = nodeData(graph, id);
  const what = semanticsOf(graph, id)?.what;
  return { id, type: node.type, ...(what != null ? { what } : {}) };
}

// djb2 — a compact, blob-free string hash so a repetition signature can include a
// potentially huge `tool_input` without carrying the string itself.
const DJB2_SEED = 5381;
const DJB2_MULTIPLIER = 33;
const BASE36 = 36;

export function hash(value: string): string {
  let h = DJB2_SEED;
  for (let i = 0; i < value.length; i += 1) h = (h * DJB2_MULTIPLIER) ^ value.charCodeAt(i);
  return (h >>> 0).toString(BASE36);
}
