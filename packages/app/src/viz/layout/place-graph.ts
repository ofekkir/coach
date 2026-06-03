import type {
  AgentExecution,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '@coach/pipeline';
import { estimateNodeH } from './estimate.ts';
import { buildLabelLines } from '../format/format.ts';
import { link, placeThread } from './place-members.ts';
import { pushStructural } from './place-segment.ts';
import type { Ctx } from './types.ts';
import { HG, LG, NW, VG } from './types.ts';

export function sessionWidth(sv: SessionExecution): number {
  return sv.interactions.reduce((max, i) => {
    const w = i.threads.length * NW + Math.max(0, i.threads.length - 1) * HG;
    return Math.max(max, w);
  }, NW);
}

function placeInteraction(
  interaction: InteractionExecution,
  parentId: string,
  y: number,
  ctx: Ctx,
): number {
  const root = interaction.root;
  const threads: readonly Thread[] = interaction.threads;
  const isExpanded = ctx.expanded.has(root.id);
  const hasKids = threads.some((t) => t.members.length > 0);

  pushStructural(root, 'interaction', ctx.cx - NW / 2, y, hasKids, ctx);
  link(parentId, root.id, undefined, ctx);
  y += estimateNodeH(buildLabelLines(root.canonical)) + (isExpanded && hasKids ? LG : VG);
  if (!isExpanded || !hasKids) return y;

  const totalW = threads.length * NW + (threads.length - 1) * HG;
  let tx = ctx.cx - totalW / 2;
  let maxEndY = y;

  for (const thread of threads) {
    const endY = placeThread(thread, root.id, tx, y, ctx);
    maxEndY = Math.max(maxEndY, endY);
    tx += NW + HG;
  }

  return maxEndY + VG;
}

function placeSession(session: SessionExecution, parentId: string, y: number, ctx: Ctx): number {
  const root = session.root;
  const isExpanded = ctx.expanded.has(root.id);
  const hasKids = session.interactions.length > 0;

  pushStructural(root, 'session', ctx.cx - NW / 2, y, hasKids, ctx);
  link(parentId, root.id, undefined, ctx);
  y += estimateNodeH(buildLabelLines(root.canonical)) + (isExpanded && hasKids ? LG : VG);
  if (!isExpanded || !hasKids) return y;

  for (const interaction of session.interactions) {
    y = placeInteraction(interaction, root.id, y, ctx);
  }

  return y;
}

export function placeAgent(agent: AgentExecution, ctx: Ctx): void {
  const root = agent.root;
  const isExpanded = ctx.expanded.has(root.id);
  const hasKids = agent.sessions.length > 0;

  pushStructural(root, 'root', ctx.cx - NW / 2, 50, hasKids, ctx);
  if (!isExpanded || !hasKids) return;

  const y = 50 + estimateNodeH(buildLabelLines(root.canonical)) + LG;
  const sessionWidths = agent.sessions.map((s) => sessionWidth(s));
  const totalW = sessionWidths.reduce((sum, w) => sum + w, 0) + (agent.sessions.length - 1) * HG;
  let sx = ctx.cx - totalW / 2;

  for (let i = 0; i < agent.sessions.length; i++) {
    const session = agent.sessions[i];
    if (session == null) continue;
    const sw = sessionWidths[i] ?? NW;
    const savedCx = ctx.cx;
    ctx.cx = sx + sw / 2;
    placeSession(session, root.id, y, ctx);
    ctx.cx = savedCx;
    sx += sw + HG;
  }
}
