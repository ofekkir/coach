import type {
  AgentExecution,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '@coach/pipeline';
import { estimateNodeH } from './estimate.ts';
import { buildNodeCard, formatGap } from '../format/format.ts';
import { causalLink, link, placeThread, pushStructural } from './place-members.ts';
import type { Ctx } from './types.ts';
import { CANVAS_TOP, CENTERING_DIVISOR, HG, LG, NW, VG } from './types.ts';

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
  const hasKids = threads.some((t) => t.members.length > 0) || interaction.userPrompt != null;

  pushStructural(root, 'interaction', ctx.cx - NW / CENTERING_DIVISOR, y, hasKids, ctx);
  link(parentId, root.id, undefined, ctx);
  y += estimateNodeH(buildNodeCard(root.canonical)) + (isExpanded && hasKids ? LG : VG);
  if (!isExpanded || !hasKids) return y;

  placeUserPrompt(interaction.userPrompt, root.id, y, ctx);
  if (interaction.userPrompt != null) {
    y += estimateNodeH(buildNodeCard(interaction.userPrompt.canonical)) + VG;
  }

  const totalW = threads.length * NW + (threads.length - 1) * HG;
  let tx = ctx.cx - totalW / CENTERING_DIVISOR;
  let maxEndY = y;

  for (const thread of threads) {
    const endY = placeThread(thread, tx, y, ctx);
    maxEndY = Math.max(maxEndY, endY);
    tx += NW + HG;
  }

  placeCausalEdges(interaction, ctx);
  return maxEndY + VG;
}

// Draws the interaction's causal flow between the placed nodes. Only edges whose
// both endpoints are placed (visible in the expanded interaction) are drawn — a
// collapsed member would otherwise leave a dangling edge.
function placeCausalEdges(interaction: InteractionExecution, ctx: Ctx): void {
  const placed = new Set(ctx.nodes.map((n) => n.id));
  interaction.causalEdges
    .filter((e) => placed.has(e.fromId) && placed.has(e.toId))
    .forEach((e) => {
      causalLink(e.fromId, e.toId, formatGap(e.gapMs) ?? undefined, ctx);
    });
}

// Places the synthesized user-prompt node as the interaction's first child and
// returns the id threads should descend from (the prompt when present).
function placeUserPrompt(
  userPrompt: InteractionExecution['userPrompt'],
  rootId: string,
  y: number,
  ctx: Ctx,
): string {
  if (userPrompt == null) return rootId;
  pushStructural(userPrompt, 'member', ctx.cx - NW / CENTERING_DIVISOR, y, false, ctx);
  link(rootId, userPrompt.id, undefined, ctx);
  return userPrompt.id;
}

function placeSession(session: SessionExecution, parentId: string, y: number, ctx: Ctx): number {
  const root = session.root;
  const isExpanded = ctx.expanded.has(root.id);
  const hasKids = session.interactions.length > 0;

  pushStructural(root, 'session', ctx.cx - NW / CENTERING_DIVISOR, y, hasKids, ctx);
  link(parentId, root.id, undefined, ctx);
  y += estimateNodeH(buildNodeCard(root.canonical)) + (isExpanded && hasKids ? LG : VG);
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

  pushStructural(root, 'root', ctx.cx - NW / CENTERING_DIVISOR, CANVAS_TOP, hasKids, ctx);
  if (!isExpanded || !hasKids) return;

  const y = CANVAS_TOP + estimateNodeH(buildNodeCard(root.canonical)) + LG;
  const sessionWidths = agent.sessions.map((s) => sessionWidth(s));
  const totalW = sessionWidths.reduce((sum, w) => sum + w, 0) + (agent.sessions.length - 1) * HG;
  let sx = ctx.cx - totalW / CENTERING_DIVISOR;

  for (let i = 0; i < agent.sessions.length; i++) {
    const session = agent.sessions[i];
    if (session == null) continue;
    const sw = sessionWidths[i] ?? NW;
    const savedCx = ctx.cx;
    ctx.cx = sx + sw / CENTERING_DIVISOR;
    placeSession(session, root.id, y, ctx);
    ctx.cx = savedCx;
    sx += sw + HG;
  }
}
