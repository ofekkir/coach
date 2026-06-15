import type { ExecutionNode, GraphNode, Thread } from '@coach/pipeline';
import { estimateNodeH } from './estimate.ts';
import { buildNodeCard } from '../format/format.ts';
import { isWeakModel } from '../theme.ts';
import { canonOf } from './resolve.ts';
import type { Ctx, HiddenSubCall, TraceRFNodeData } from './types.ts';
import { NESTED_INDENT, VG } from './types.ts';

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

/** Reusable card push for a structural execution node (agent/session/interaction/prompt). */
export function pushStructural(
  node: ExecutionNode,
  kind: TraceRFNodeData['kind'],
  x: number,
  y: number,
  hasKids: boolean,
  ctx: Ctx,
): void {
  push(
    node.id,
    x,
    y,
    {
      kind,
      card: buildNodeCard(canonOf(ctx, node)),
      ...STRUCTURAL_FLAGS,
      hasRFChildren: hasKids,
      isExpanded: ctx.expanded.has(node.id),
      selected: node.id === ctx.selected,
    },
    ctx,
  );
}

function durationOf(node: GraphNode): number {
  return 'duration_ms' in node ? node.duration_ms : 0;
}

// Recursively finds a weak-model inference nested inside a tool/action (the call
// lives under the tool's `execution` child), so the details panel can surface the
// hidden sub-call that often dominates the tool's wall-clock.
function hiddenSubCallOf(node: ExecutionNode, ctx: Ctx): HiddenSubCall | undefined {
  for (const child of node.children) {
    const c = canonOf(ctx, child);
    if ((c.type === 'inference' || c.type === 'llm_request') && isWeakModel(c.model)) {
      return { model: c.model, durationMs: durationOf(c) };
    }
    const nested = hiddenSubCallOf(child, ctx);
    if (nested != null) return nested;
  }
  return undefined;
}

// Share-of-run flags for a spine step: whether it is the interaction's longest
// step and, if so, its slice of the interaction's wall-clock (for the bar).
function shareFlags(
  node: ExecutionNode,
  ctx: Ctx,
): Pick<TraceRFNodeData, 'isLongest' | 'shareOfRun'> {
  if (node.id !== ctx.longestId) return { isLongest: false };
  const dur = durationOf(canonOf(ctx, node));
  const total = ctx.interactionDurMs ?? 0;
  return { isLongest: true, ...(total > 0 ? { shareOfRun: Math.min(1, dur / total) } : {}) };
}

// Places one execution-graph node as a card. Steps are not expandable: a tool's
// raw sub-spans (`tool.execution` / `tool.blocked_on_user`) never become cards —
// only its one meaningful nested inference does, surfaced by `placeStep`.
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
      card: buildNodeCard(canonOf(ctx, node)),
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

// The one meaningful child of a tool: the weak model running *inside* it (e.g.
// WebFetch's `web_fetch_apply` → claude-haiku). Found by descending through the
// mechanical `execution`/`blocked_on_user` sub-spans, which are never carded.
function nestedInferenceNode(node: ExecutionNode, ctx: Ctx): ExecutionNode | undefined {
  for (const child of node.children) {
    const t = canonOf(ctx, child).type;
    if (t === 'inference' || t === 'llm_request') return child;
    const deeper = nestedInferenceNode(child, ctx);
    if (deeper != null) return deeper;
  }
  return undefined;
}

// Places a step card and, when it is a tool with a weak-model sub-call, the one
// nested-inference card indented beneath it. Returns the next y.
export function placeStep(
  member: ExecutionNode,
  tx: number,
  y: number,
  lane: TraceRFNodeData['lane'],
  ctx: Ctx,
): number {
  pushExecNode(member, tx, y, lane, false, ctx);
  let next = y + estimateNodeH(buildNodeCard(canonOf(ctx, member))) + VG;
  const nested = nestedInferenceNode(member, ctx);
  if (nested != null) {
    pushExecNode(nested, tx + NESTED_INDENT, next, lane, true, ctx);
    next += estimateNodeH(buildNodeCard(canonOf(ctx, nested))) + VG;
  }
  return next;
}

// Stacks a thread's members in a column (layout only). No member-to-member edges:
// member order is not causality — the causal flow is drawn by place-graph. Used
// for the dimmed background lane (always linear).
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
