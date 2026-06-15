import type {
  AgentExecution,
  GraphEdge,
  GraphNode,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '@coach/pipeline';
import { estimateNodeH } from './estimate.ts';
import { buildNodeCard, formatGap } from '../format/format.ts';
import { causalLink, link } from './edges.ts';
import { placeThread, pushStructural } from './place-members.ts';
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

function durationOf(node: GraphNode): number | undefined {
  return 'duration_ms' in node ? node.duration_ms : undefined;
}

// The interaction's longest step — the one (and the edge into it) that wears the
// accent — taken over the main thread's top-level members.
function longestStepId(thread: Thread | undefined): string | undefined {
  if (thread == null) return undefined;
  let id: string | undefined;
  let maxMs = 0;
  for (const member of thread.members) {
    const ms = durationOf(member.canonical) ?? 0;
    if (ms > maxMs) {
      maxMs = ms;
      id = member.id;
    }
  }
  return maxMs > 0 ? id : undefined;
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
  link(parentId, root.id, ctx);
  y += estimateNodeH(buildNodeCard(root.canonical)) + (isExpanded && hasKids ? LG : VG);
  if (!isExpanded || !hasKids) return y;

  placeUserPrompt(interaction.userPrompt, root.id, y, ctx);
  if (interaction.userPrompt != null) {
    y += estimateNodeH(buildNodeCard(interaction.userPrompt.canonical)) + VG;
  }

  const mainThread = threads.find((t) => t.source === MAIN_THREAD_SOURCE) ?? threads[0];
  const backgroundThreads = threads.filter((t) => t !== mainThread);
  ctx.longestId = longestStepId(mainThread);
  ctx.interactionDurMs = durationOf(root.canonical);

  const levels = mainThread != null ? parallelLevelsOf(mainThread, interaction) : [];
  ctx.criticalIds = new Set(levels.map((l) => l.criticalId));

  const spineX = ctx.cx - NW / CENTERING_DIVISOR;
  const mainEndY = mainThread != null ? placeSpine(mainThread, spineX, y, levels, ctx) : y;
  const laneEndY = placeBackgroundLane(backgroundThreads, spineX + NW + LANE_GAP, y, ctx);

  placeCausalEdges(interaction, ctx);
  ctx.longestId = undefined;
  ctx.interactionDurMs = undefined;
  ctx.criticalIds = undefined;
  return Math.max(mainEndY, laneEndY) + VG;
}

// Parallel levels (fork → branches → join) detected on the main thread from the
// interaction's causal edges — the critical branch is the slowest by duration.
function parallelLevelsOf(mainThread: Thread, interaction: InteractionExecution) {
  const memberIds = new Set(mainThread.members.map((m) => m.id));
  const durById = new Map(mainThread.members.map((m) => [m.id, durationOf(m.canonical) ?? 0]));
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

function endNsOf(node: GraphNode): bigint | null {
  return 'end_time_ns' in node && node.end_time_ns !== '0' ? BigInt(node.end_time_ns) : null;
}

function startNsOf(node: GraphNode): bigint | null {
  return 'start_time_ns' in node && node.start_time_ns !== '0' ? BigInt(node.start_time_ns) : null;
}

const NS_PER_MS = 1_000_000;

// The signed gap (ms) between cause-end and effect-start, computed app-side so the
// delta shows on every edge whose endpoints carry timing — the pipeline leaves
// `gapMs` unset on fan-out/fan-in edges, but the timestamps are present. Falls
// back to the pipeline value when given (it encodes nested-span semantics).
function gapLabel(edge: GraphEdge, byId: ReadonlyMap<string, GraphNode>): string | undefined {
  if (edge.gapMs != null) return formatGap(edge.gapMs) ?? undefined;
  const from = byId.get(edge.fromId);
  const to = byId.get(edge.toId);
  if (from == null || to == null) return undefined;
  const end = endNsOf(from);
  const start = startNsOf(to);
  if (end == null || start == null) return undefined;
  return formatGap(Number(start - end) / NS_PER_MS) ?? undefined;
}

function canonicalById(interaction: InteractionExecution): Map<string, GraphNode> {
  const byId = new Map<string, GraphNode>();
  const add = (n: {
    id: string;
    canonical: GraphNode;
    children: readonly { id: string }[];
  }): void => {
    byId.set(n.id, n.canonical);
  };
  const walk = (node: InteractionExecution['root']): void => {
    add(node);
    node.children.forEach(walk);
  };
  interaction.threads.flatMap((t) => t.members).forEach(walk);
  if (interaction.userPrompt != null) walk(interaction.userPrompt);
  walk(interaction.root);
  return byId;
}

// Draws the interaction's causal flow between the placed nodes. Only edges whose
// both endpoints are placed (visible in the expanded interaction) are drawn — a
// collapsed member would otherwise leave a dangling edge.
function placeCausalEdges(interaction: InteractionExecution, ctx: Ctx): void {
  const placed = new Set(ctx.nodes.map((n) => n.id));
  const byId = canonicalById(interaction);
  interaction.causalEdges
    .filter((e) => placed.has(e.fromId) && placed.has(e.toId))
    .forEach((e) => {
      causalLink(e.fromId, e.toId, gapLabel(e, byId), ctx);
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
  link(rootId, userPrompt.id, ctx);
  return userPrompt.id;
}

function placeSession(session: SessionExecution, parentId: string, y: number, ctx: Ctx): number {
  const root = session.root;
  const isExpanded = ctx.expanded.has(root.id);
  const hasKids = session.interactions.length > 0;

  pushStructural(root, 'session', ctx.cx - NW / CENTERING_DIVISOR, y, hasKids, ctx);
  link(parentId, root.id, ctx);
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
