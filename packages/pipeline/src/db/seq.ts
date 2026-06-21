// Dense per-interaction sequence. Scope: every node that shares an interaction_id
// (the whole interaction), ranked by start_time_ns ascending and compared as int64
// (BigInt) so values of differing digit-length sort numerically, not lexically.
// Ties break on id for determinism. Yields a dense 0..n-1 with no gaps/dupes; nodes
// without an interactionId get no seq (NULL).

import type { CanonicalNode } from '../types.ts';

function compareByStartTime(a: CanonicalNode, b: CanonicalNode): number {
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
