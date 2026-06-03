import type { ExecutionNode, Segment, SemanticNode } from '@coach/pipeline';
import { colorOf, fillOf, segmentAccentOf } from './colors.ts';
import { estimateNodeH } from './estimate.ts';
import { buildLabelLines } from '../format/format.ts';
import { link, push } from './place-members.ts';
import type { Ctx, TraceRFNodeData } from './types.ts';
import { VG, subgraphId } from './types.ts';

function semanticLabelLines(node: SemanticNode): string[] {
  const moveVerbs = node.moves.map((m) => m.verb).filter((v, i, arr) => arr.indexOf(v) === i);
  const lines = ['semantic'];
  if (moveVerbs.length > 0) lines.push(moveVerbs.join(' · '));
  if (node.actionVerbs.length > 0) lines.push(`acts: ${node.actionVerbs.join(' · ')}`);
  return lines;
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
      hasRFChildren: hasKids,
      isExpanded: ctx.expanded.has(node.id),
      selected: node.id === ctx.selected,
    },
    ctx,
  );
}

function pushSemanticNode(
  node: SemanticNode,
  segmentIndex: number,
  x: number,
  y: number,
  isExpanded: boolean,
  ctx: Ctx,
): void {
  const accent = segmentAccentOf(segmentIndex);
  const id = subgraphId(node.id);
  push(
    id,
    x,
    y,
    {
      kind: 'semantic',
      labelLines: semanticLabelLines(node),
      color: accent,
      fill: `${accent}10`,
      hasRFChildren: node.execution.length > 0,
      isExpanded,
      selected: id === ctx.selected,
      stepKind: 'semantic',
      moves: node.moves,
      actionVerbs: node.actionVerbs,
      segmentIndex,
    },
    ctx,
  );
}

function placeWrappedExecution(node: SemanticNode, x: number, startY: number, ctx: Ctx): number {
  let y = startY;
  let prevId = subgraphId(node.id);
  for (const exec of node.execution) {
    const labelLines = buildLabelLines(exec.canonical);
    pushStructural(exec, 'member', x, y, false, ctx);
    link(prevId, exec.id, undefined, ctx);
    prevId = exec.id;
    y += estimateNodeH(labelLines) + VG;
  }
  return y;
}

function placeSemanticNode(
  node: SemanticNode,
  segmentIndex: number,
  parentId: string,
  x: number,
  startY: number,
  ctx: Ctx,
): number {
  const id = subgraphId(node.id);
  const isExpanded = ctx.expanded.has(id);
  pushSemanticNode(node, segmentIndex, x, startY, isExpanded, ctx);
  link(parentId, id, undefined, ctx);
  const y = startY + estimateNodeH(semanticLabelLines(node)) + VG;
  if (isExpanded && node.execution.length > 0) return placeWrappedExecution(node, x, y, ctx);
  return y;
}

export function placeSegment(
  segment: Segment,
  parentId: string,
  x: number,
  startY: number,
  ctx: Ctx,
): number {
  const id = subgraphId(`seg-${parentId}-${String(segment.index)}`);
  const accent = segmentAccentOf(segment.index);
  const labelLines = ['segment', segment.label];
  push(
    id,
    x,
    startY,
    {
      kind: 'segment',
      labelLines,
      color: accent,
      fill: `${accent}10`,
      hasRFChildren: segment.members.length > 0,
      isExpanded: true,
      selected: id === ctx.selected,
      segmentIndex: segment.index,
    },
    ctx,
  );
  link(parentId, id, undefined, ctx);
  let y = startY + estimateNodeH(labelLines) + VG;
  for (const member of segment.members) {
    y = placeSemanticNode(member, segment.index, id, x, y, ctx);
  }
  return y;
}
