import { MarkerType } from '@xyflow/react';
import type { ExecutionNode, Thread } from '@coach/pipeline';
import { colorOf, fillOf } from './colors.ts';
import { estimateNodeH } from './estimate.ts';
import { buildNodeCard, threadTitle } from '../format/format.ts';
import type { Ctx, TraceRFNodeData } from './types.ts';
import { VG } from './types.ts';

function push(id: string, x: number, y: number, data: TraceRFNodeData, ctx: Ctx): void {
  ctx.nodes.push({
    id,
    type: 'trace',
    position: { x, y },
    data,
    selected: data.selected,
  });
}

export function link(src: string, tgt: string, label: string | undefined, ctx: Ctx): void {
  ctx.edges.push({
    id: `e-${src}-${tgt}`,
    source: src,
    target: tgt,
    type: 'smoothstep',
    ...(label != null
      ? {
          label,
          labelStyle: { fill: '#94a3b8', fontSize: 10 },
          labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.9 },
        }
      : {}),
    style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#cbd5e1', width: 14, height: 14 },
  });
}

// The causal dataflow overlay (inference → tool fan-out, tool → inference fan-in).
// Drawn distinct from the grey structural/sequence links: dashed amber, carrying
// the signed gap ("+12ms" / "-3ms" — negative when a tool was dispatched before
// its inference finished streaming). Higher zIndex so it reads on top of the lane.
export function causalLink(src: string, tgt: string, label: string | undefined, ctx: Ctx): void {
  ctx.edges.push({
    id: `causal-${src}-${tgt}`,
    source: src,
    target: tgt,
    type: 'smoothstep',
    zIndex: 1,
    ...(label != null
      ? {
          label,
          labelStyle: { fill: '#b45309', fontSize: 10 },
          labelBgStyle: { fill: '#fffbeb', fillOpacity: 0.95 },
        }
      : {}),
    style: { stroke: '#f59e0b', strokeWidth: 1.5, strokeDasharray: '5 3' },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b', width: 14, height: 14 },
  });
}

/** Reusable card push for a structural execution node (agent/session/interaction/member). */
export function pushStructural(
  node: ExecutionNode,
  kind: TraceRFNodeData['kind'],
  x: number,
  y: number,
  hasKids: boolean,
  ctx: Ctx,
): void {
  const card = buildNodeCard(node.canonical);
  push(
    node.id,
    x,
    y,
    {
      kind,
      card,
      canonical: node.canonical,
      color: colorOf(card.type),
      fill: fillOf(card.type),
      hasRFChildren: hasKids,
      isExpanded: ctx.expanded.has(node.id),
      selected: node.id === ctx.selected,
    },
    ctx,
  );
}

function pushExecNode(
  node: ExecutionNode,
  kind: TraceRFNodeData['kind'],
  x: number,
  y: number,
  hasRFChildren: boolean,
  isExpanded: boolean,
  ctx: Ctx,
): void {
  const card = buildNodeCard(node.canonical);
  push(
    node.id,
    x,
    y,
    {
      kind,
      card,
      canonical: node.canonical,
      color: colorOf(card.type),
      fill: fillOf(card.type),
      hasRFChildren,
      isExpanded,
      selected: node.id === ctx.selected,
    },
    ctx,
  );
}

// Recursively places a node's children when expanded — each child that itself has
// expanded children drills in further (e.g. tool ▸ tool.execution ▸ llm_request).
// Returns the bottom y and the last-placed id so the next sibling chains from it.
function placeSubtree(
  node: ExecutionNode,
  tx: number,
  startY: number,
  ctx: Ctx,
): { y: number; lastId: string } {
  let y = startY;
  let lastId = node.id;
  for (const child of node.children) {
    const hasKids = child.children.length > 0;
    const isExpanded = hasKids && ctx.expanded.has(child.id);
    pushExecNode(child, 'member', tx, y, hasKids, isExpanded, ctx);
    link(lastId, child.id, undefined, ctx);
    y += estimateNodeH(buildNodeCard(child.canonical)) + VG;
    lastId = child.id;
    if (!isExpanded) continue;
    const sub = placeSubtree(child, tx, y, ctx);
    y = sub.y;
    lastId = sub.lastId;
  }
  return { y, lastId };
}

// Sequence edges no longer carry a gap (time-adjacency is not causality — the
// signed gap lives on the causal overlay). Only the first edge is labelled, with
// the thread's title.
function edgeLabelFor(thread: Thread, index: number): string | undefined {
  return index === 0 ? threadTitle(thread.source) : undefined;
}

export function placeThread(
  thread: Thread,
  parentId: string,
  tx: number,
  startY: number,
  ctx: Ctx,
): number {
  let y = startY;
  let prevId = parentId;

  for (let i = 0; i < thread.members.length; i++) {
    const member = thread.members[i];
    if (member == null) continue;
    const hasSubNodes = member.children.length > 0;
    const isExpandedMember = hasSubNodes && ctx.expanded.has(member.id);

    pushExecNode(member, 'member', tx, y, hasSubNodes, isExpandedMember, ctx);
    link(prevId, member.id, edgeLabelFor(thread, i), ctx);
    y += estimateNodeH(buildNodeCard(member.canonical)) + VG;

    let lastId = member.id;
    if (isExpandedMember) {
      const sub = placeSubtree(member, tx, y, ctx);
      y = sub.y;
      lastId = sub.lastId;
    }

    prevId = lastId;
  }

  return y;
}
