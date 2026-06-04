import type { ExecutionNode, Segment, Step } from '@coach/pipeline';
import { colorOf, fillOf, segmentAccentOf } from './colors.ts';
import { estimateNodeH } from './estimate.ts';
import { buildLabelLines } from '../format/format.ts';
import { link, placeSubtree, push } from './place-members.ts';
import type { Ctx, TraceRFNodeData } from './types.ts';
import { VG } from './types.ts';

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

// A step card IS its execution node (badge LLM/TOOL), annotated with the step's
// semantics (kind + verb/moves, accented by segment). Expanding drills into the
// node's lifecycle children (tool.blocked_on_user, tool.execution, hooks).
function pushStep(step: Step, segmentIndex: number, x: number, y: number, ctx: Ctx): void {
  const node = step.execution;
  const labelLines = buildLabelLines(node.canonical);
  const type = labelLines[0] ?? '';
  push(
    node.id,
    x,
    y,
    {
      kind: 'step',
      labelLines,
      canonical: node.canonical,
      color: colorOf(type),
      fill: fillOf(type),
      hasRFChildren: node.children.length > 0,
      isExpanded: ctx.expanded.has(node.id),
      selected: node.id === ctx.selected,
      stepKind: step.kind,
      ...(step.verb != null ? { verb: step.verb } : {}),
      moves: step.moves,
      segmentIndex,
    },
    ctx,
  );
}

function placeStep(
  step: Step,
  segmentIndex: number,
  parentId: string,
  x: number,
  startY: number,
  ctx: Ctx,
): number {
  const node = step.execution;
  const isExpanded = ctx.expanded.has(node.id);
  pushStep(step, segmentIndex, x, startY, ctx);
  link(parentId, node.id, undefined, ctx);
  const y = startY + estimateNodeH(buildLabelLines(node.canonical)) + VG;
  if (isExpanded && node.children.length > 0) return placeSubtree(node, x, y, ctx).y;
  return y;
}

export function placeSegment(
  segment: Segment,
  id: string,
  parentId: string,
  edgeLabel: string | undefined,
  x: number,
  startY: number,
  ctx: Ctx,
): number {
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
      hasRFChildren: segment.steps.length > 0,
      isExpanded: true,
      selected: id === ctx.selected,
      segmentIndex: segment.index,
    },
    ctx,
  );
  link(parentId, id, edgeLabel, ctx);
  let y = startY + estimateNodeH(labelLines) + VG;
  for (const step of segment.steps) {
    y = placeStep(step, segment.index, id, x, y, ctx);
  }
  return y;
}
