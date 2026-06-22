import type {
  AgentExecution,
  CanonicalNode,
  CausalEdge,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '@coach/pipeline';
import { estimateNodeH } from './estimate.ts';
import { buildAgentCard, buildPromptCard, buildSessionCard, formatGap } from '../format/format.ts';
import type { NodeCard } from '../format/format.ts';
import { causalLink, link } from './edges.ts';
import { cardOf, nodeOf, placeThread, pushStructural } from './place-members.ts';
import { placeSpine } from './parallel-place.ts';
import { detectParallelLevels } from './parallel.ts';
import type { Ctx } from './types.ts';
import { CANVAS_TOP, CENTERING_DIVISOR, HG, LANE_GAP, LG, NW, VG } from './types.ts';

// The loop that emits the spine; every other thread is off-spine housekeeping.
const MAIN_THREAD_SOURCE = 'repl_main_thread';

export function sessionWidth(sv: SessionExecution): number {
  return sv.interactions.reduce((max, i) => {
    const hasLane = i.threads.length > 1;
    const w = NW + (hasLane ? LANE_GAP + NW : 0);
    return Math.max(max, w);
  }, NW);
}

function durationOf(node: CanonicalNode): number | undefined {
  return 'duration_ms' in node ? node.duration_ms : undefined;
}

// The longest step (and its share-of-run) the renderer accents: the heaviest
// main-thread member by duration, with the interaction's own wall-clock as the
// denominator. A render-time pick over the graph — not a shared analysis stage.
function applyLongestStep(mainThread: Thread | undefined, interactionId: string, ctx: Ctx): void {
  ctx.interactionDurMs = durationOf(nodeOf(ctx, interactionId));
  if (mainThread == null) return;
  let longestId: string | undefined;
  let longestMs = 0;
  for (const member of mainThread.members) {
    const ms = durationOf(nodeOf(ctx, member.id)) ?? 0;
    if (ms <= longestMs) continue;
    longestMs = ms;
    longestId = member.id;
  }
  if (longestMs > 0) ctx.longestId = longestId;
}

function placeInteraction(
  interaction: InteractionExecution,
  parentId: string,
  y: number,
  ctx: Ctx,
): number {
  const rootId = interaction.interactionId;
  const threads: readonly Thread[] = interaction.threads;
  const isExpanded = ctx.expanded.has(rootId);
  const promptCard = promptCardOf(ctx, rootId);
  const hasKids = threads.some((t) => t.members.length > 0) || promptCard != null;
  const rootCard = cardOf(ctx, rootId);

  pushStructural(rootId, rootCard, 'interaction', ctx.cx - NW / CENTERING_DIVISOR, y, hasKids, ctx);
  link(parentId, rootId, ctx);
  y += estimateNodeH(rootCard) + (isExpanded && hasKids ? LG : VG);
  if (!isExpanded || !hasKids) return y;

  let promptId: string | null = null;
  if (promptCard != null) {
    promptId = placeUserPrompt(promptCard, rootId, y, ctx);
    y += estimateNodeH(promptCard) + VG;
  }

  const mainThread = threads.find((t) => t.source === MAIN_THREAD_SOURCE) ?? threads[0];
  const backgroundThreads = threads.filter((t) => t !== mainThread);
  applyLongestStep(mainThread, rootId, ctx);

  const levels = mainThread != null ? parallelLevelsOf(mainThread, interaction, ctx) : [];
  ctx.criticalIds = new Set(levels.map((l) => l.criticalId));

  const spineX = ctx.cx - NW / CENTERING_DIVISOR;
  const mainEndY = mainThread != null ? placeSpine(mainThread, spineX, y, levels, ctx) : y;
  const laneEndY = placeBackgroundLane(backgroundThreads, spineX + NW + LANE_GAP, y, ctx);

  placeCausalEdges(interaction, ctx);
  linkPromptToThreadHeads(promptId, threads, ctx);
  ctx.longestId = undefined;
  ctx.interactionDurMs = undefined;
  ctx.criticalIds = undefined;
  return Math.max(mainEndY, laneEndY) + VG;
}

// Parallel levels (fork → branches → join) detected on the main thread from the
// interaction's causal edges — the critical branch is the slowest by duration.
function parallelLevelsOf(mainThread: Thread, interaction: InteractionExecution, ctx: Ctx) {
  const memberIds = new Set(mainThread.members.map((m) => m.id));
  const durById = new Map(
    mainThread.members.map((m) => [m.id, durationOf(nodeOf(ctx, m.id)) ?? 0]),
  );
  return detectParallelLevels(memberIds, interaction.causalEdges, (id) => durById.get(id) ?? 0);
}

// Stacks the off-spine threads (session-title, away-summary, …) in a dimmed side
// lane to the right of the spine, never inline on it.
function placeBackgroundLane(
  backgroundThreads: readonly Thread[],
  laneX: number,
  startY: number,
  ctx: Ctx,
): number {
  let y = startY;
  for (const thread of backgroundThreads) {
    y = placeThread(thread, laneX, y, 'background', ctx) + VG;
  }
  return y;
}

function endNsOf(node: CanonicalNode): bigint | null {
  return 'end_time_ns' in node && node.end_time_ns !== '0' ? BigInt(node.end_time_ns) : null;
}

function startNsOf(node: CanonicalNode): bigint | null {
  return 'start_time_ns' in node && node.start_time_ns !== '0' ? BigInt(node.start_time_ns) : null;
}

const NS_PER_MS = 1_000_000;

// The signed gap (ms) between cause-end and effect-start, computed app-side so the
// delta shows on every edge whose endpoints carry timing — the pipeline leaves
// `gapMs` unset on fan-out/fan-in edges, but the timestamps are present. Falls
// back to the pipeline value when given (it encodes nested-span semantics).
function gapLabel(edge: CausalEdge, ctx: Ctx): string | undefined {
  if (edge.gapMs != null) return formatGap(edge.gapMs) ?? undefined;
  const end = endNsOf(nodeOf(ctx, edge.fromId));
  const start = startNsOf(nodeOf(ctx, edge.toId));
  if (end == null || start == null) return undefined;
  return formatGap(Number(start - end) / NS_PER_MS) ?? undefined;
}

// Draws the interaction's causal flow between the placed nodes. Only edges whose
// both endpoints are placed (visible in the expanded interaction) are drawn — a
// collapsed member would otherwise leave a dangling edge.
function placeCausalEdges(interaction: InteractionExecution, ctx: Ctx): void {
  const placed = new Set(ctx.nodes.map((n) => n.id));
  interaction.causalEdges
    .filter((e) => placed.has(e.fromId) && placed.has(e.toId))
    .forEach((e) => {
      causalLink(e.fromId, e.toId, gapLabel(e, ctx), ctx);
    });
}

// The spine-head anchor, derived from `InteractionNode.prompt` (there is no prompt
// node). Null when the interaction has no prompt text.
function promptCardOf(ctx: Ctx, interactionId: string): NodeCard | null {
  const node = nodeOf(ctx, interactionId);
  const prompt = node.type === 'interaction' ? node.prompt : '';
  return prompt.trim() !== '' ? buildPromptCard(prompt) : null;
}

// Places the synthesized prompt anchor as the interaction's first child and returns
// its render-only id (`${rootId}__prompt`) — it has no backing node, so it resolves
// to no row in the details panel, exactly like the agent/session entity cards.
function placeUserPrompt(card: NodeCard, rootId: string, y: number, ctx: Ctx): string {
  const id = `${rootId}__prompt`;
  pushStructural(id, card, 'member', ctx.cx - NW / CENTERING_DIVISOR, y, false, ctx);
  link(rootId, id, ctx);
  return id;
}

// Restores the prompt → first-member edge for every thread. The dropped user_prompt
// node used to seed each thread's spine head; with it gone, the render-only prompt
// anchor takes over, so background threads (and the main spine) read as triggered by
// the prompt instead of floating. Cross-lane handles route the background edges
// through the cards' sides; the same-lane main edge stays a vertical spine link.
function linkPromptToThreadHeads(
  promptId: string | null,
  threads: readonly Thread[],
  ctx: Ctx,
): void {
  if (promptId == null) return;
  const placed = new Set(ctx.nodes.map((n) => n.id));
  threads
    .map((thread) => thread.members[0]?.id)
    .filter((id): id is string => id != null && placed.has(id))
    .forEach((headId) => {
      causalLink(promptId, headId, undefined, ctx);
    });
}

function placeSession(session: SessionExecution, parentId: string, y: number, ctx: Ctx): number {
  const id = session.session.id;
  const card = buildSessionCard(session.session);
  const isExpanded = ctx.expanded.has(id);
  const hasKids = session.interactions.length > 0;

  pushStructural(id, card, 'session', ctx.cx - NW / CENTERING_DIVISOR, y, hasKids, ctx);
  link(parentId, id, ctx);
  y += estimateNodeH(card) + (isExpanded && hasKids ? LG : VG);
  if (!isExpanded || !hasKids) return y;

  for (const interaction of session.interactions) {
    y = placeInteraction(interaction, id, y, ctx);
  }

  return y;
}

export function placeAgent(agent: AgentExecution, ctx: Ctx): void {
  const id = agent.agent.id;
  const card = buildAgentCard(agent.agent);
  const isExpanded = ctx.expanded.has(id);
  const hasKids = agent.sessions.length > 0;

  pushStructural(id, card, 'root', ctx.cx - NW / CENTERING_DIVISOR, CANVAS_TOP, hasKids, ctx);
  if (!isExpanded || !hasKids) return;

  const y = CANVAS_TOP + estimateNodeH(card) + LG;
  const sessionWidths = agent.sessions.map((s) => sessionWidth(s));
  const totalW = sessionWidths.reduce((sum, w) => sum + w, 0) + (agent.sessions.length - 1) * HG;
  let sx = ctx.cx - totalW / CENTERING_DIVISOR;

  for (let i = 0; i < agent.sessions.length; i++) {
    const session = agent.sessions[i];
    if (session == null) continue;
    const sw = sessionWidths[i] ?? NW;
    const savedCx = ctx.cx;
    ctx.cx = sx + sw / CENTERING_DIVISOR;
    placeSession(session, id, y, ctx);
    ctx.cx = savedCx;
    sx += sw + HG;
  }
}
