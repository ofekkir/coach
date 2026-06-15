import type { ExecutionNode, GraphNode } from '@coach/pipeline';
import type { Ctx } from './types.ts';

// The execution tree carries ids only; layout reads each node's data (type, name,
// timing, model) from the table on `ctx`. Centralizes the not-found guard so call
// sites read a plain GraphNode, never `| undefined`.
export function canonOf(ctx: Ctx, node: ExecutionNode): GraphNode {
  const canonical = ctx.byId.get(node.id);
  if (canonical == null) throw new Error(`layout has no node with id: ${node.id}`);
  return canonical;
}
