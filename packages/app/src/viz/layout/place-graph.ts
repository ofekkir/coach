import type {
  AgentCausalGraphView,
  GraphViewNode,
  GraphViewThread,
  SessionCausalGraphView,
} from '@coach/pipeline';
import { colorOf, fillOf } from './colors.ts';
import { estimateNodeH } from './estimate.ts';
import { link, placeThread, push } from './place-members.ts';
import type { Ctx } from './types.ts';
import { HG, LG, NW, VG } from './types.ts';

export function sessionWidth(sv: SessionCausalGraphView): number {
  return sv.interactions.reduce((max, i) => {
    const w = i.view.threads.length * NW + Math.max(0, i.view.threads.length - 1) * HG;
    return Math.max(max, w);
  }, NW);
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

export function placeAgent(agent: AgentCausalGraphView, ctx: Ctx): void {
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
