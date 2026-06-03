import type {
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  InteractionSemantics,
  SemanticGraph,
} from '@coach/pipeline';
import type { Edge } from '@xyflow/react';
import { estimateNodeH } from './estimate.ts';
import { buildLabelLines } from '../format/format.ts';
import { link } from './place-members.ts';
import { placeSegment, pushStructural } from './place-segment.ts';
import { toAgent } from './queries.ts';
import type { Ctx, TraceRFNode } from './types.ts';
import { HG, LG, NW, VG, subgraphId } from './types.ts';

type SessionExec = AgentExecution['sessions'][number];

function semanticsFor(
  semantic: SemanticGraph,
  interactionId: string,
): InteractionSemantics | undefined {
  return semantic.interactions.find((i) => i.interactionId === interactionId);
}

function pushInteractionWithShape(
  semantics: InteractionSemantics,
  root: ExecutionNode,
  startY: number,
  ctx: Ctx,
): void {
  const labelLines = buildLabelLines(root.canonical);
  ctx.nodes.push({
    id: root.id,
    type: 'trace',
    position: { x: ctx.cx - NW / 2, y: startY },
    selected: root.id === ctx.selected,
    data: {
      kind: 'interaction',
      labelLines,
      canonical: root.canonical,
      color: '#5599BB',
      fill: '#EDF5FB',
      hasRFChildren: semantics.segments.length > 0,
      isExpanded: ctx.expanded.has(root.id),
      selected: root.id === ctx.selected,
      shape: semantics.shape,
    },
  });
}

function placeInteractionSemantics(
  semantics: InteractionSemantics,
  root: ExecutionNode,
  startY: number,
  ctx: Ctx,
): number {
  const isExpanded = ctx.expanded.has(root.id);
  const hasKids = semantics.segments.length > 0;
  pushInteractionWithShape(semantics, root, startY, ctx);
  const y =
    startY + estimateNodeH(buildLabelLines(root.canonical)) + (isExpanded && hasKids ? LG : VG);
  if (!isExpanded || !hasKids) return y;

  const totalW = semantics.segments.length * NW + (semantics.segments.length - 1) * HG;
  let sx = ctx.cx - totalW / 2;
  let maxY = y;
  for (const segment of semantics.segments) {
    maxY = Math.max(maxY, placeSegment(segment, root.id, sx, y, ctx));
    sx += NW + HG;
  }
  return maxY + VG;
}

function placeOneInteraction(
  interaction: SessionExec['interactions'][number],
  semantic: SemanticGraph,
  parentId: string,
  startY: number,
  ctx: Ctx,
): number {
  link(parentId, interaction.root.id, undefined, ctx);
  const sem = semanticsFor(semantic, interaction.root.id);
  if (sem == null) {
    pushStructural(interaction.root, 'interaction', ctx.cx - NW / 2, startY, false, ctx);
    return startY + estimateNodeH(buildLabelLines(interaction.root.canonical)) + VG;
  }
  return placeInteractionSemantics(sem, interaction.root, startY, ctx);
}

function placeSemanticSession(
  session: SessionExec,
  semantic: SemanticGraph,
  parentId: string,
  startY: number,
  ctx: Ctx,
): number {
  const root = session.root;
  const isExpanded = ctx.expanded.has(root.id);
  const hasKids = session.interactions.length > 0;
  pushStructural(root, 'session', ctx.cx - NW / 2, startY, hasKids, ctx);
  link(parentId, root.id, undefined, ctx);
  let y =
    startY + estimateNodeH(buildLabelLines(root.canonical)) + (isExpanded && hasKids ? LG : VG);
  if (!isExpanded || !hasKids) return y;

  for (const interaction of session.interactions) {
    y = placeOneInteraction(interaction, semantic, root.id, y, ctx);
  }
  return y;
}

function placeSemanticAgent(agent: AgentExecution, semantic: SemanticGraph, ctx: Ctx): void {
  const root = agent.root;
  const hasKids = agent.sessions.length > 0;
  pushStructural(root, 'root', ctx.cx - NW / 2, 50, hasKids, ctx);
  if (!ctx.expanded.has(root.id) || !hasKids) return;

  let y = 50 + estimateNodeH(buildLabelLines(root.canonical)) + LG;
  for (const session of agent.sessions) {
    y = placeSemanticSession(session, semantic, root.id, y, ctx);
  }
}

export function buildSemanticElements(
  execution: ExecutionGraph,
  semantic: SemanticGraph,
  expanded: Set<string>,
  selected: string | null,
): { nodes: TraceRFNode[]; edges: Edge[] } {
  const agent = toAgent(execution);
  const ctx: Ctx = { cx: NW * 4, expanded, selected, nodes: [], edges: [] };
  placeSemanticAgent(agent, semantic, ctx);
  return { nodes: ctx.nodes, edges: ctx.edges };
}

function addInteractionExpandables(
  session: SessionExec,
  semantic: SemanticGraph,
  ids: Set<string>,
): void {
  for (const interaction of session.interactions) {
    ids.add(interaction.root.id);
    const sem = semanticsFor(semantic, interaction.root.id);
    if (sem == null) continue;
    sem.segments
      .flatMap((s) => s.members)
      .filter((m) => m.execution.length > 0)
      .forEach((m) => ids.add(subgraphId(m.id)));
  }
}

export function allSemanticExpandableIds(
  execution: ExecutionGraph,
  semantic: SemanticGraph,
): Set<string> {
  const agent = toAgent(execution);
  const ids = new Set<string>([agent.root.id]);
  for (const session of agent.sessions) {
    ids.add(session.root.id);
    addInteractionExpandables(session, semantic, ids);
  }
  return ids;
}
