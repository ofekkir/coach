import { type ExecutionGraph, type InteractionExecution } from '../types.ts';
import { durationMs } from './access.ts';
import type { CriticalPath } from './types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Critical path — the slowest route through one interaction's causal DAG
// (`causalEdges`), summing node durations along the way. Parallel branches
// overlap in wall-clock, so the path follows only the slowest at each fork; the
// summed duration of the chosen route approximates the interaction's wall-clock
// spine. A longest-weighted-path DP over the DAG (memoized, source → sink).
// ════════════════════════════════════════════════════════════════════════════

interface Route {
  readonly dist: number;
  readonly path: readonly string[];
}

function weightOf(graph: ExecutionGraph, id: string): number {
  const node = graph.nodes[id];
  return node != null ? durationMs(node) : 0;
}

function successors(interaction: InteractionExecution): Map<string, string[]> {
  const succ = new Map<string, string[]>();
  for (const edge of interaction.causalEdges) {
    const list = succ.get(edge.fromId);
    if (list != null) list.push(edge.toId);
    else succ.set(edge.fromId, [edge.toId]);
  }
  return succ;
}

function longestFrom(
  graph: ExecutionGraph,
  succ: Map<string, string[]>,
  id: string,
  memo: Map<string, Route>,
): Route {
  const cached = memo.get(id);
  if (cached != null) return cached;

  const placeholder: Route = { dist: weightOf(graph, id), path: [id] };
  memo.set(id, placeholder); // guards against a stray cycle

  const best = (succ.get(id) ?? []).reduce<Route>(
    (acc, next) => {
      const tail = longestFrom(graph, succ, next, memo);
      return tail.dist > acc.dist ? tail : acc;
    },
    { dist: 0, path: [] },
  );

  const route: Route = { dist: weightOf(graph, id) + best.dist, path: [id, ...best.path] };
  memo.set(id, route);
  return route;
}

/** The slowest causal route through the interaction. Null when there are no causal
 *  edges (e.g. a bare query turn). Lifts the per-level "slowest branch" idea from
 *  the app's `viz/layout/parallel.ts` to a whole-interaction path. */
export function criticalPath(
  graph: ExecutionGraph,
  interaction: InteractionExecution,
): CriticalPath | null {
  if (interaction.causalEdges.length === 0) return null;

  const succ = successors(interaction);
  const targets = new Set(interaction.causalEdges.map((e) => e.toId));
  const sources = [...new Set(interaction.causalEdges.map((e) => e.fromId))].filter(
    (id) => !targets.has(id),
  );
  if (sources.length === 0) return null; // a pure cycle — no entry point

  const memo = new Map<string, Route>();
  const best = sources.reduce<Route>(
    (acc, src) => {
      const route = longestFrom(graph, succ, src, memo);
      return route.dist > acc.dist ? route : acc;
    },
    { dist: 0, path: [] },
  );

  return { nodeIds: best.path, durationMs: best.dist };
}
