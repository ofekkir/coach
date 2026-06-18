import { nodeData, type ExecutionGraph, type InteractionExecution } from '../types.ts';

/** The heaviest node by a metric, with its share of the scope total — `shareOfScope`
 *  is the fill fraction of the accent share-of-run bar the renderer draws.
 *  `nodeId` resolves through `graph.nodes` (or `inspect_node`, for an MCP). */
export interface Hotspot {
  readonly nodeId: string;
  readonly metric: 'latency' | 'cost' | 'tokens';
  readonly value: number;
  readonly shareOfScope: number; // value / scope total, 0..1
}

// The loop that emits the spine; every other thread is off-spine housekeeping.
const MAIN_THREAD_SOURCE = 'repl_main_thread';

/** The interaction's longest step by duration, taken over the main thread's
 *  top-level members — the node the renderer wears its accent on. `shareOfScope`
 *  is its fraction of the interaction's wall-clock. Null when nothing has duration.
 *
 *  Moved out of the app's `viz/layout/place-graph.ts` so the renderer and any
 *  other consumer (the MCP) read one derivation instead of recomputing it. */
export function longestStep(
  graph: ExecutionGraph,
  interaction: InteractionExecution,
): Hotspot | null {
  const main =
    interaction.threads.find((t) => t.source === MAIN_THREAD_SOURCE) ?? interaction.threads[0];
  if (main == null) return null;

  let id: string | undefined;
  let value = 0;
  for (const member of main.members) {
    const ms = nodeData(graph, member.id).duration_ms;
    if (ms <= value) continue;
    value = ms;
    id = member.id;
  }
  if (id == null || value === 0) return null;

  const wallMs = nodeData(graph, interaction.interactionId).duration_ms;
  return {
    nodeId: id,
    metric: 'latency',
    value,
    shareOfScope: wallMs > 0 ? value / wallMs : 0,
  };
}
