import type { CanonicalNode } from '../types.ts';

function compareByStartTime(a: CanonicalNode, b: CanonicalNode): number {
  // Why: start_time_ns is a stringified int64; compare as BigInt so values of
  // differing digit-length sort numerically rather than lexically.
  const [at, bt] = [BigInt(a.start_time_ns), BigInt(b.start_time_ns)];
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function seqByNodeId(nodes: readonly CanonicalNode[]): Map<string, number> {
  const byInteraction = new Map<string, CanonicalNode[]>();
  for (const node of nodes) {
    if (node.interactionId == null) continue;
    const group = byInteraction.get(node.interactionId) ?? [];
    group.push(node);
    byInteraction.set(node.interactionId, group);
  }
  const seq = new Map<string, number>();
  for (const group of byInteraction.values())
    group.sort(compareByStartTime).forEach((node, index) => seq.set(node.id, index));
  return seq;
}
