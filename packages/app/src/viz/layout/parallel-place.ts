import type { ExecutionNode, Thread } from '@coach/pipeline';
import { estimateNodeH } from './estimate.ts';
import { buildNodeCard } from '../format/format.ts';
import type { ParallelLevel } from './parallel.ts';
import { placeStep, pushExecNode } from './place-members.ts';
import { canonOf } from './resolve.ts';
import type { Ctx } from './types.ts';
import { CENTERING_DIVISOR, COMPACT_NW, HG, NW, PARALLEL_COMPACT_THRESHOLD, VG } from './types.ts';

// Padding around a parallel-level band, and the headroom above the row for its label.
const BAND_PAD = 12;
const BAND_LABEL_H = 22;

// Backdrop node for a parallel level — pushed before its branch cards so it sits
// behind them; it is non-selectable so clicks pass through to the cards.
function pushBand(
  level: ParallelLevel,
  x: number,
  y: number,
  w: number,
  h: number,
  ctx: Ctx,
): void {
  ctx.nodes.push({
    id: `band-${level.forkId}`,
    type: 'band',
    position: { x, y },
    data: { width: w, height: h },
    draggable: false,
    selectable: false,
  });
}

function startNsOf(node: ExecutionNode, ctx: Ctx): bigint {
  const canonical = canonOf(ctx, node);
  return 'start_time_ns' in canonical ? BigInt(canonical.start_time_ns) : 0n;
}

// Branches ordered left→right by start time (ascending), so the eye reads the
// fan-out in dispatch order — a critical branch that isn't leftmost then reveals a
// scheduling gap worth optimizing.
function orderedBranches(
  level: ParallelLevel,
  memberById: ReadonlyMap<string, ExecutionNode>,
  ctx: Ctx,
): ExecutionNode[] {
  return level.childIds
    .map((id) => memberById.get(id))
    .filter((m): m is ExecutionNode => m != null)
    .sort((a, b) =>
      startNsOf(a, ctx) < startNsOf(b, ctx) ? -1 : startNsOf(a, ctx) > startNsOf(b, ctx) ? 1 : 0,
    );
}

// Lays a parallel level as a centered row inside a faint band: branches spread
// horizontally between the fork (above) and the join (placed later, below),
// ordered by start time. The slowest branch is the critical path — it alone wears
// the accent. Returns the y below the row. `topY` is the y under the fork card.
function placeLevelRow(
  level: ParallelLevel,
  spineX: number,
  topY: number,
  memberById: ReadonlyMap<string, ExecutionNode>,
  ctx: Ctx,
): number {
  const children = orderedBranches(level, memberById, ctx);
  const compact = children.length > PARALLEL_COMPACT_THRESHOLD;
  const cw = compact ? COMPACT_NW : NW;
  const totalW = children.length * cw + (children.length - 1) * HG;
  const rowH = Math.max(...children.map((c) => estimateNodeH(buildNodeCard(canonOf(ctx, c)))));

  const spineCenter = spineX + NW / CENTERING_DIVISOR;
  const startX = spineCenter - totalW / CENTERING_DIVISOR;
  const rowY = topY + BAND_LABEL_H;

  pushBand(
    level,
    startX - BAND_PAD,
    rowY - BAND_PAD,
    totalW + BAND_PAD + BAND_PAD,
    rowH + BAND_PAD + BAND_PAD,
    ctx,
  );
  children.forEach((child, i) => {
    pushExecNode(child, startX + i * (cw + HG), rowY, 'main', false, ctx, {
      critical: child.id === level.criticalId,
      compact,
    });
  });
  return rowY + rowH + VG;
}

// The main thread, parallel-aware: members walk in order, but a fork's branches
// are pulled out of the column into a centered row (the join follows below). With
// no parallel levels it degrades to a clean linear spine.
export function placeSpine(
  thread: Thread,
  tx: number,
  startY: number,
  levels: readonly ParallelLevel[],
  ctx: Ctx,
): number {
  const byFork = new Map(levels.map((l) => [l.forkId, l]));
  const childIds = new Set(levels.flatMap((l) => l.childIds));
  const memberById = new Map(thread.members.map((m) => [m.id, m]));

  let y = startY;
  for (const member of thread.members) {
    if (childIds.has(member.id)) continue;
    y = placeStep(member, tx, y, 'main', ctx);
    const level = byFork.get(member.id);
    if (level != null) y = placeLevelRow(level, tx, y, memberById, ctx);
  }
  return y;
}
