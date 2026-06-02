import type { GraphViewNode } from '@coach/pipeline';

export function estimateNodeH(gvNode: GraphViewNode): number {
  const body = gvNode.labelLines.slice(1);
  const timingIdx = body.findIndex((l) => l.startsWith('duration:'));
  const hasTiming = timingIdx >= 0;
  const displayLines = hasTiming ? body.filter((_, i) => i !== timingIdx) : body;
  const hasName = displayLines.length > 0;
  const detailCount = Math.max(0, displayLines.length - (hasName ? 1 : 0));

  return Math.max(62, 28 + 6 + (hasName ? 18 : 0) + detailCount * 16 + (hasTiming ? 20 : 0) + 8);
}
