import { MarkerType } from '@xyflow/react';
import type { GraphViewNode, GraphViewThread } from '@coach/pipeline';
import { colorOf, fillOf } from './colors.ts';
import { estimateNodeH } from './estimate.ts';
import type { Ctx, TraceRFNodeData } from './types.ts';
import { VG } from './types.ts';

export function push(id: string, x: number, y: number, data: TraceRFNodeData, ctx: Ctx): void {
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

function lastChildY(member: GraphViewNode, startY: number): number {
  return member.children.reduce((y, child) => y + estimateNodeH(child) + VG, startY);
}

function placeExpandedChildren(
  member: GraphViewNode,
  tx: number,
  startY: number,
  ctx: Ctx,
): string {
  let y = startY;
  let lastId = member.id;
  for (const child of member.children) {
    const childType = child.labelLines[0] ?? '';
    push(
      child.id,
      tx,
      y,
      {
        kind: 'member',
        gvNode: child,
        color: colorOf(childType),
        fill: fillOf(childType),
        hasRFChildren: false,
        isExpanded: false,
        selected: child.id === ctx.selected,
      },
      ctx,
    );
    link(lastId, child.id, undefined, ctx);
    lastId = child.id;
    y += estimateNodeH(child) + VG;
  }
  return lastId;
}

export function placeThread(
  thread: GraphViewThread,
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
    const type = member.labelLines[0] ?? '';
    const hasSubNodes = member.children.length > 0;
    const isExpandedMember = hasSubNodes && ctx.expanded.has(member.id);
    const edgeLabel = i === 0 ? undefined : thread.edges[i - 1]?.label;

    push(
      member.id,
      tx,
      y,
      {
        kind: 'member',
        gvNode: member,
        color: colorOf(type),
        fill: fillOf(type),
        hasRFChildren: hasSubNodes,
        isExpanded: isExpandedMember,
        selected: member.id === ctx.selected,
      },
      ctx,
    );

    link(prevId, member.id, edgeLabel, ctx);
    y += estimateNodeH(member) + VG;

    let lastId = member.id;
    if (isExpandedMember) {
      lastId = placeExpandedChildren(member, tx, y, ctx);
      y = lastChildY(member, y);
    }

    prevId = lastId;
  }

  return y;
}
