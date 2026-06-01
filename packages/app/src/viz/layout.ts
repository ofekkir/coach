import { MarkerType } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import type {
  AgentCausalGraphView,
  GraphViewNode,
  GraphViewThread,
  SessionCausalGraphView,
  VizData,
} from '@coach/pipeline';

// ── constants ─────────────────────────────────────────────────────────────────
const NW = 210; // node width (fixed)
const HG = 56; // horizontal gap between parallel threads
const VG = 44; // vertical gap between sequential nodes
const LG = 60; // level gap – parent bottom to first child top

// ── Paul Tol "Muted" palette ──────────────────────────────────────────────────
// Keys must match labelLines[0] values produced by view-model.ts buildLabelLines().
const TYPE_COLORS: Record<string, string> = {
  agent: '#44AA99',
  session: '#332288',
  interaction: '#5599BB',
  llm_request: '#882255',
  tool: '#CC6677',
  blocked_on_user: '#B8A840', // labelLines[0] for tool.blocked_on_user
  execution: '#999933', // labelLines[0] for tool.execution
  hook: '#117733',
};

const TYPE_FILLS: Record<string, string> = {
  agent: '#EAF6F4',
  session: '#EAEBF5',
  interaction: '#EDF5FB',
  llm_request: '#F2E9ED',
  tool: '#F9EDEF',
  blocked_on_user: '#FBF9EC',
  execution: '#F4F4E9',
  hook: '#E5F0E9',
};

export function colorOf(type: string): string {
  return TYPE_COLORS[type] ?? '#94a3b8';
}

function fillOf(type: string): string {
  return TYPE_FILLS[type] ?? '#f8fafc';
}

// ── dynamic node height ───────────────────────────────────────────────────────
// Estimates the rendered height of a node given its labelLines.
// Assumes white-space: nowrap (each label line = exactly 1 rendered line).
//
//  28px  header (badge row)
//   6px  body top padding
//  18px  name line + margin  (if present)
//  16px  × N detail lines
//  20px  timing pill          (if present)
//   8px  body bottom padding
function estimateNodeH(gvNode: GraphViewNode): number {
  const body = gvNode.labelLines.slice(1);
  const timingIdx = body.findIndex((l) => l.startsWith('duration:'));
  const hasTiming = timingIdx >= 0;
  const displayLines = hasTiming ? body.filter((_, i) => i !== timingIdx) : body;
  const hasName = displayLines.length > 0;
  const detailCount = Math.max(0, displayLines.length - (hasName ? 1 : 0));

  return Math.max(62, 28 + 6 + (hasName ? 18 : 0) + detailCount * 16 + (hasTiming ? 20 : 0) + 8);
}

// ── RF node data shape ────────────────────────────────────────────────────────
type NodeKind = 'root' | 'session' | 'interaction' | 'member';

// Extends Record<string, unknown> to satisfy React Flow's Node<T> constraint.
export interface TraceRFNodeData extends Record<string, unknown> {
  kind: NodeKind;
  gvNode: GraphViewNode;
  color: string;
  fill: string;
  hasRFChildren: boolean;
  isExpanded: boolean;
  selected: boolean;
}

export type TraceRFNode = Node<TraceRFNodeData, 'trace'>;

// ── build context ──────────────────────────────────────────────────────────────
interface Ctx {
  cx: number;
  expanded: Set<string>;
  selected: string | null;
  nodes: TraceRFNode[];
  edges: Edge[];
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

function link(src: string, tgt: string, label: string | undefined, ctx: Ctx): void {
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

// ── placement ─────────────────────────────────────────────────────────────────

// Returns the y-position after placing all expanded children of a member node.
function lastChildY(member: GraphViewNode, startY: number): number {
  return member.children.reduce((y, child) => y + estimateNodeH(child) + VG, startY);
}

// Places expanded children of a member node and returns the last child's id.
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

function placeThread(
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
    // Timing gap: goes on the edge from prevId (which may be the last child
    // of the previous member when it was expanded) to this member.
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

    // Expand GraphViewNode children (blocked_on_user, execution) as separate
    // RF nodes only when this member is expanded.
    let lastId = member.id;
    if (isExpandedMember) {
      lastId = placeExpandedChildren(member, tx, y, ctx);
      y = lastChildY(member, y);
    }

    prevId = lastId;
  }

  return y;
}

function placeInteraction(
  id: string,
  gvNode: GraphViewNode,
  parentId: string,
  threads: readonly GraphViewThread[],
  y: number,
  ctx: Ctx,
): number {
  const isExpanded = ctx.expanded.has(id);
  const hasKids = threads.some((t) => t.members.length > 0);
  const type = gvNode.labelLines[0] ?? '';

  push(
    id,
    ctx.cx - NW / 2,
    y,
    {
      kind: 'interaction',
      gvNode,
      color: colorOf(type),
      fill: fillOf(type),
      hasRFChildren: hasKids,
      isExpanded,
      selected: id === ctx.selected,
    },
    ctx,
  );

  link(parentId, id, undefined, ctx);
  y += estimateNodeH(gvNode) + (isExpanded && hasKids ? LG : VG);
  if (!isExpanded || !hasKids) return y;

  const totalW = threads.length * NW + (threads.length - 1) * HG;
  let tx = ctx.cx - totalW / 2;
  let maxEndY = y;

  for (const thread of threads) {
    const endY = placeThread(thread, id, tx, y, ctx);
    maxEndY = Math.max(maxEndY, endY);
    tx += NW + HG;
  }

  return maxEndY + VG;
}

function placeSession(
  id: string,
  gvNode: GraphViewNode,
  parentId: string,
  interactions: SessionCausalGraphView['interactions'],
  y: number,
  ctx: Ctx,
): number {
  const isExpanded = ctx.expanded.has(id);
  const hasKids = interactions.length > 0;
  const type = gvNode.labelLines[0] ?? '';

  push(
    id,
    ctx.cx - NW / 2,
    y,
    {
      kind: 'session',
      gvNode,
      color: colorOf(type),
      fill: fillOf(type),
      hasRFChildren: hasKids,
      isExpanded,
      selected: id === ctx.selected,
    },
    ctx,
  );

  link(parentId, id, undefined, ctx);
  y += estimateNodeH(gvNode) + (isExpanded && hasKids ? LG : VG);
  if (!isExpanded || !hasKids) return y;

  for (const { view: iv } of interactions) {
    y = placeInteraction(iv.root.id, iv.root, id, iv.threads, y, ctx);
  }

  return y;
}

function sessionWidth(sv: SessionCausalGraphView): number {
  return sv.interactions.reduce((max, i) => {
    const w = i.view.threads.length * NW + Math.max(0, i.view.threads.length - 1) * HG;
    return Math.max(max, w);
  }, NW);
}

function placeAgent(agent: AgentCausalGraphView, ctx: Ctx): void {
  const root = agent.root;
  const isExpanded = ctx.expanded.has(root.id);
  const hasKids = agent.sessions.length > 0;
  const type = root.labelLines[0] ?? '';

  push(
    root.id,
    ctx.cx - NW / 2,
    50,
    {
      kind: 'root',
      gvNode: root,
      color: colorOf(type),
      fill: fillOf(type),
      hasRFChildren: hasKids,
      isExpanded,
      selected: root.id === ctx.selected,
    },
    ctx,
  );

  if (!isExpanded || !hasKids) return;

  const y = 50 + estimateNodeH(root) + LG;
  const sessionWidths = agent.sessions.map((s) => sessionWidth(s.view));
  const totalW = sessionWidths.reduce((sum, w) => sum + w, 0) + (agent.sessions.length - 1) * HG;
  let sx = ctx.cx - totalW / 2;

  for (let i = 0; i < agent.sessions.length; i++) {
    const session = agent.sessions[i];
    if (session == null) continue;
    const { view: sv } = session;
    const sw = sessionWidths[i] ?? NW;
    const savedCx = ctx.cx;
    ctx.cx = sx + sw / 2;
    placeSession(sv.root.id, sv.root, root.id, sv.interactions, y, ctx);
    ctx.cx = savedCx;
    sx += sw + HG;
  }
}

// ── normalise to agent ────────────────────────────────────────────────────────

export function toAgent(data: VizData): AgentCausalGraphView {
  if (data.kind === 'agent') return data.data;

  const FAKE: GraphViewNode = {
    id: '__root__',
    labelLines: ['agent'],
    children: [],
    innerEdges: [],
  };

  if (data.kind === 'session') {
    return { root: FAKE, sessions: [{ title: 'session', view: data.data }] };
  }

  const fakeSession: SessionCausalGraphView = {
    root: { id: '__session__', labelLines: ['session'], children: [], innerEdges: [] },
    interactions: data.data != null ? [{ title: 'interaction', view: data.data }] : [],
  };
  return { root: FAKE, sessions: [{ title: 'session', view: fakeSession }] };
}

// ── public API ────────────────────────────────────────────────────────────────

export function buildElements(
  data: VizData,
  expanded: Set<string>,
  selected: string | null,
): { nodes: TraceRFNode[]; edges: Edge[] } {
  const agent = toAgent(data);
  // Center the agent root over the total width of all sessions laid out horizontally.
  const totalSessionsW = agent.sessions.reduce((sum, s, i) => {
    return sum + sessionWidth(s.view) + (i > 0 ? HG : 0);
  }, 0);
  const ctx: Ctx = {
    cx: Math.max(NW, totalSessionsW) / 2 + 50,
    expanded,
    selected,
    nodes: [],
    edges: [],
  };
  placeAgent(agent, ctx);
  return { nodes: ctx.nodes, edges: ctx.edges };
}

export function initialExpanded(): Set<string> {
  return new Set<string>();
}

function expandableInteractionIds(iv: {
  root: GraphViewNode;
  threads: readonly GraphViewThread[];
}): string[] {
  const memberIds = iv.threads
    .flatMap((thread) => thread.members)
    .filter((m) => m.children.length > 0)
    .map((m) => m.id);
  return [iv.root.id, ...memberIds];
}

export function allExpandableIds(data: VizData): Set<string> {
  const agent = toAgent(data);
  const sessionIds = agent.sessions.map((s) => s.view.root.id);
  const interactionExpandables = agent.sessions.flatMap((s) =>
    s.view.interactions.flatMap((i) => expandableInteractionIds(i.view)),
  );
  const ids = new Set([agent.root.id, ...sessionIds, ...interactionExpandables]);
  return ids;
}

export function agentRoot(data: VizData): string {
  return toAgent(data).root.id;
}
