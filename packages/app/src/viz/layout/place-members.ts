import type { CanonicalNode, ExecutionNode, Thread } from '@coach/pipeline';
import { nodeData, resolve } from '@coach/pipeline';

import { buildNodeCard, type NodeCard } from '../format/format.ts';
import { isWeakModel } from '../theme.ts';

import { estimateNodeH } from './estimate.ts';
import type { Ctx, HiddenSubCall, TraceRFNodeData } from './types.ts';
import { NESTED_INDENT, VG } from './types.ts';

export function nodeOf(ctx: Ctx, id: string): CanonicalNode {
  return nodeData(ctx.graph, id);
}

export function cardOf(ctx: Ctx, id: string, index = 0): NodeCard {
  return buildNodeCard(resolve(ctx.graph, id), index);
}

function push(id: string, x: number, y: number, data: TraceRFNodeData, ctx: Ctx): void {
  ctx.nodes.push({
    id,
    type: 'trace',
    position: { x, y },
    data,
    selected: data.selected,
  });
}

const STRUCTURAL_FLAGS: Pick<TraceRFNodeData, 'lane' | 'nested' | 'isLongest'> = {
  lane: 'main',
  nested: false,
  isLongest: false,
};

/** Card push for a structural container (agent/session entity, interaction or
 *  prompt node). The card is pre-resolved by the caller — entities build theirs
 *  from `buildAgentCard`/`buildSessionCard`, nodes from `cardOf`. */
export function pushStructural(
  id: string,
  card: NodeCard,
  kind: TraceRFNodeData['kind'],
  x: number,
  y: number,
  hasKids: boolean,
  ctx: Ctx,
): void {
  push(
    id,
    x,
    y,
    {
      kind,
      card,
      ...STRUCTURAL_FLAGS,
      hasRFChildren: hasKids,
      isExpanded: ctx.expanded.has(id),
      selected: id === ctx.selected,
    },
    ctx,
  );
}

function durationOf(node: CanonicalNode): number {
  return 'duration_ms' in node ? node.duration_ms : 0;
}

// Why: the weak-model call lives under the tool's `execution` child, not as a
// direct child, so we descend to surface the hidden sub-call that often dominates
// the tool's wall-clock.
function hiddenSubCallOf(node: ExecutionNode, ctx: Ctx): HiddenSubCall | undefined {
  for (const child of node.children) {
    const c = nodeOf(ctx, child.id);
    if (c.type === 'llm_request' && isWeakModel(c.model)) {
      return { model: c.model, durationMs: durationOf(c) };
    }
    const nested = hiddenSubCallOf(child, ctx);
    if (nested != null) return nested;
  }
  return undefined;
}

function shareFlags(
  node: ExecutionNode,
  ctx: Ctx,
): Pick<TraceRFNodeData, 'isLongest' | 'shareOfRun'> {
  if (node.id !== ctx.longestId) return { isLongest: false };
  const dur = durationOf(nodeOf(ctx, node.id));
  const total = ctx.interactionDurMs ?? 0;
  return { isLongest: true, ...(total > 0 ? { shareOfRun: Math.min(1, dur / total) } : {}) };
}

// Why: steps are intentionally not expandable — a tool's raw sub-spans
// (`tool.execution` / `tool.blocked_on_user`) never become cards; only its one
// meaningful nested inference does, surfaced by `placeStep`.
type ParallelFlags = Partial<Pick<TraceRFNodeData, 'critical' | 'compact'>>;

export function pushExecNode(
  node: ExecutionNode,
  x: number,
  y: number,
  lane: TraceRFNodeData['lane'],
  nested: boolean,
  ctx: Ctx,
  flags: ParallelFlags = {},
): void {
  const hiddenSubCall = hiddenSubCallOf(node, ctx);
  push(
    node.id,
    x,
    y,
    {
      kind: 'member',
      card: cardOf(ctx, node.id),
      lane,
      nested,
      ...shareFlags(node, ctx),
      ...(hiddenSubCall != null ? { hiddenSubCall } : {}),
      ...flags,
      hasRFChildren: false,
      isExpanded: false,
      selected: node.id === ctx.selected,
    },
    ctx,
  );
}

// Why: the meaningful child is the weak model running *inside* the tool (e.g.
// WebFetch's `web_fetch_apply` → claude-haiku); it hides beneath the mechanical
// `execution`/`blocked_on_user` sub-spans, which are never carded, so we descend.
function nestedInferenceNode(node: ExecutionNode, ctx: Ctx): ExecutionNode | undefined {
  for (const child of node.children) {
    if (nodeOf(ctx, child.id).type === 'llm_request') return child;
    const deeper = nestedInferenceNode(child, ctx);
    if (deeper != null) return deeper;
  }
  return undefined;
}

export function placeStep(
  member: ExecutionNode,
  tx: number,
  y: number,
  lane: TraceRFNodeData['lane'],
  ctx: Ctx,
): number {
  pushExecNode(member, tx, y, lane, false, ctx);
  let next = y + estimateNodeH(cardOf(ctx, member.id)) + VG;
  const nested = nestedInferenceNode(member, ctx);
  if (nested != null) {
    pushExecNode(nested, tx + NESTED_INDENT, next, lane, true, ctx);
    next += estimateNodeH(cardOf(ctx, nested.id)) + VG;
  }
  return next;
}

// Why: no member-to-member edges are drawn — member order is not causality; the
// causal flow is drawn by place-graph. This stacks members linearly for the
// dimmed background lane.
export function placeThread(
  thread: Thread,
  tx: number,
  startY: number,
  lane: TraceRFNodeData['lane'],
  ctx: Ctx,
): number {
  let y = startY;
  for (const member of thread.members) {
    y = placeStep(member, tx, y, lane, ctx);
  }
  return y;
}
