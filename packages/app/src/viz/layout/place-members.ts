import { MarkerType } from '@xyflow/react';
import type { ExecutionNode, Thread } from '@coach/pipeline';
import { colorOf, fillOf } from './colors.ts';
import { estimateNodeH } from './estimate.ts';
import { buildLabelLines, formatGap, threadTitle } from '../format/format.ts';
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

function pushExecNode(
  node: ExecutionNode,
  kind: TraceRFNodeData['kind'],
  x: number,
  y: number,
  hasRFChildren: boolean,
  isExpanded: boolean,
  ctx: Ctx,
): void {
  const labelLines = buildLabelLines(node.canonical);
  const type = labelLines[0] ?? '';
  push(
    node.id,
    x,
    y,
    {
      kind,
      labelLines,
      canonical: node.canonical,
      color: colorOf(type),
      fill: fillOf(type),
      hasRFChildren,
      isExpanded,
      selected: node.id === ctx.selected,
    },
    ctx,
  );
}

function placeExpandedChildren(
  member: ExecutionNode,
  tx: number,
  startY: number,
  ctx: Ctx,
): string {
  let y = startY;
  let lastId = member.id;
  for (const child of member.children) {
    pushExecNode(child, 'member', tx, y, false, false, ctx);
    link(lastId, child.id, undefined, ctx);
    lastId = child.id;
    y += estimateNodeH(buildLabelLines(child.canonical)) + VG;
  }
  return lastId;
}

function lastChildY(member: ExecutionNode, startY: number): number {
  return member.children.reduce(
    (y, child) => y + estimateNodeH(buildLabelLines(child.canonical)) + VG,
    startY,
  );
}

function edgeLabelFor(thread: Thread, index: number): string | undefined {
  if (index === 0) return threadTitle(thread.source);
  const gap = thread.edges[index - 1]?.gapMs;
  return formatGap(gap) ?? undefined;
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
    y += estimateNodeH(buildLabelLines(member.canonical)) + VG;

    let lastId = member.id;
    if (isExpandedMember) {
      lastId = placeExpandedChildren(member, tx, y, ctx);
      y = lastChildY(member, y);
    }

    prevId = lastId;
  }

  return y;
}
