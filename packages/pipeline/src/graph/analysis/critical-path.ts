import { type ExecutionGraph, type InteractionExecution } from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Critical path — the slowest route through one interaction's causal DAG
// (`causalEdges`), summing node durations along the way. Parallel branches
// overlap in wall-clock, so the path follows only the slowest at each fork; the
// summed duration of the chosen route approximates the interaction's wall-clock
// spine.
//
// A longest-weighted-path over the DAG, computed iteratively: Kahn topological
// order, then a single reverse-order sweep where each node takes the best of its
// successors. Maps 1:1 to the recursive CTE this becomes once the graph is in a
// relational store.
// ════════════════════════════════════════════════════════════════════════════

/** The slowest path through one interaction's causal DAG, summing node durations. */
export interface CriticalPath {
  readonly nodeIds: readonly string[]; // ordered cause → effect
  readonly durationMs: number;
}

function weightOf(graph: ExecutionGraph, id: string): number {
  return graph.nodes[id]?.duration_ms ?? 0;
}

function successorsOf(interaction: InteractionExecution): Map<string, string[]> {
  const succ = new Map<string, string[]>();
  for (const edge of interaction.causalEdges) {
    const list = succ.get(edge.fromId);
    if (list != null) list.push(edge.toId);
    else succ.set(edge.fromId, [edge.toId]);
  }
  return succ;
}

function indegrees(
  nodeIds: ReadonlySet<string>,
  succ: ReadonlyMap<string, string[]>,
): Map<string, number> {
  const degree = new Map<string, number>([...nodeIds].map((id) => [id, 0]));
  for (const targets of succ.values()) {
    targets.forEach((to) => degree.set(to, (degree.get(to) ?? 0) + 1));
  }
  return degree;
}

// Decrement each successor's indegree; those that hit zero are ready to emit.
function release(
  id: string,
  succ: ReadonlyMap<string, string[]>,
  indegree: Map<string, number>,
  ready: string[],
): void {
  for (const to of succ.get(id) ?? []) {
    const left = (indegree.get(to) ?? 0) - 1;
    indegree.set(to, left);
    if (left === 0) ready.push(to);
  }
}

// Kahn's algorithm — node ids in topological order. Cycle nodes (none in a valid
// DAG) are simply omitted, leaving them with the default best of 0.
function topologicalOrder(
  nodeIds: ReadonlySet<string>,
  succ: ReadonlyMap<string, string[]>,
): string[] {
  const indegree = indegrees(nodeIds, succ);
  const ready = [...nodeIds].filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.pop();
    if (id == null) break;
    order.push(id);
    release(id, succ, indegree, ready);
  }
  return order;
}

interface Best {
  readonly dist: number;
  readonly next: string | undefined;
}

// One reverse-topological sweep: each node's best route is its own weight plus the
// heaviest successor's route. `next` threads the chosen route for reconstruction.
function bestRoutes(
  graph: ExecutionGraph,
  order: readonly string[],
  succ: ReadonlyMap<string, string[]>,
): Map<string, Best> {
  const best = new Map<string, Best>();
  for (const id of [...order].reverse()) {
    const heaviest = (succ.get(id) ?? []).reduce<Best>(
      (acc, to) => {
        const dist = best.get(to)?.dist ?? 0;
        return dist > acc.dist ? { dist, next: to } : acc;
      },
      { dist: 0, next: undefined },
    );
    best.set(id, { dist: weightOf(graph, id) + heaviest.dist, next: heaviest.next });
  }
  return best;
}

function reconstruct(start: string, best: ReadonlyMap<string, Best>): string[] {
  const path: string[] = [];
  let id: string | undefined = start;
  while (id != null) {
    path.push(id);
    id = best.get(id)?.next;
  }
  return path;
}

/** The slowest causal route through the interaction. Null when there are no causal
 *  edges (e.g. a bare query turn). Lifts the per-level "slowest branch" idea from
 *  the app's `viz/layout/parallel.ts` to a whole-interaction path. */
export function criticalPath(
  graph: ExecutionGraph,
  interaction: InteractionExecution,
): CriticalPath | null {
  if (interaction.causalEdges.length === 0) return null;

  const nodeIds = new Set(interaction.causalEdges.flatMap((e) => [e.fromId, e.toId]));
  const targets = new Set(interaction.causalEdges.map((e) => e.toId));
  const sources = [...nodeIds].filter((id) => !targets.has(id));
  if (sources.length === 0) return null; // a pure cycle — no entry point

  const succ = successorsOf(interaction);
  const best = bestRoutes(graph, topologicalOrder(nodeIds, succ), succ);
  const start = sources.reduce((a, b) =>
    (best.get(b)?.dist ?? 0) > (best.get(a)?.dist ?? 0) ? b : a,
  );

  return { nodeIds: reconstruct(start, best), durationMs: best.get(start)?.dist ?? 0 };
}
