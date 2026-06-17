import type { NodeType } from '../../types.ts';
import type { ExecutionGraph } from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Findings — mechanical, curated derivations over the ENRICHED execution graph
// (stage 6 output). Every finding points back into the node table BY ID
// (`NodeRef`); it never embeds a `CanonicalNode`. The raw node is reached on
// demand — `inspect_node(id)` for the MCP, the layout seam for the app — so a
// finding set stays small enough to drop into an agent's context.
//
// The shape mirrors `ExecutionGraph`'s `agent ▸ session ▸ interaction` levels so
// a consumer (e.g. the engineer-facing MCP) can slice it by entity directly.
// ════════════════════════════════════════════════════════════════════════════

/** A reference back into `graph.nodes`. `what` is the stage-6 label when the node
 *  was enriched — the cheap human handle, and the concrete reason findings runs
 *  over the enriched graph rather than the bare stage-5 skeleton. */
export interface NodeRef {
  readonly id: string;
  readonly type: NodeType;
  readonly what?: readonly string[]; // stage-6 action phrases, when enriched
}

/** Cost/latency/token rollup over a scope (interaction, session, or agent). Only
 *  `llm_request` nodes carry cost/tokens; `llm_request` and `tool` carry duration. */
export interface Rollup {
  readonly wallMs: number; // the scope's wall-clock
  readonly llmMs: number; // Σ llm_request.duration_ms
  readonly costUsd: number; // Σ llm_request.cost_usd
  readonly tokensIn: number; // Σ llm_request.tokens_in
  readonly tokensOut: number; // Σ llm_request.tokens_out
  readonly llmCalls: number;
  readonly toolCalls: number;
}

/** A query turn has no tool nodes; an agentic turn has ≥1. */
export type Shape = 'query' | 'agentic';

/** The heaviest node by a metric, with its share of the scope total — `shareOfScope`
 *  is the fill fraction of the accent share-of-run bar the renderer draws. */
export interface Hotspot {
  readonly node: NodeRef;
  readonly metric: 'latency' | 'cost' | 'tokens';
  readonly value: number;
  readonly shareOfScope: number; // value / scope total, 0..1
}

/** The slowest path through one interaction's causal DAG (`causalEdges`), summing
 *  node durations along the way — the wall-clock spine. */
export interface CriticalPath {
  readonly nodeIds: readonly string[]; // ordered cause → effect
  readonly durationMs: number;
}

/** Repeated identical work in one interaction. `redundant_tool` = same tool name +
 *  identical `tool_input` ≥2×. `wastedMs` sums the duration of every occurrence
 *  after the first. `signature` is a compact, blob-free grouping key. */
export interface Repetition {
  readonly kind: 'redundant_tool' | 'retry_loop';
  readonly signature: string; // `${tool_name}:${hash(tool_input)}`
  readonly occurrences: readonly NodeRef[]; // ≥2, in time order
  readonly wastedMs: number;
}

export interface InteractionFindings {
  readonly interactionId: string;
  readonly sequence: number;
  readonly shape: Shape;
  readonly rollup: Rollup;
  readonly longestStep: Hotspot | null;
  readonly criticalPath: CriticalPath | null;
  readonly repetitions: readonly Repetition[];
  /** Failed tool calls. Empty until `ToolNode` gains an error/status field — until
   *  then failures live only in the consuming inference's `tool_result` content,
   *  which the curated layer does not parse. See `FindingSet.gaps`. */
  readonly failures: readonly NodeRef[];
}

export interface SessionFindings {
  readonly sessionId: string;
  readonly rollup: Rollup;
  readonly shapeMix: Readonly<Record<Shape, number>>; // interaction counts per shape
  readonly interactions: readonly InteractionFindings[];
}

/** The full finding set for one execution graph. `kind` mirrors the graph's
 *  (possibly degraded) top level. `gaps` names findings that are not yet
 *  mechanically derivable — surfaced, never silently dropped. */
export interface FindingSet {
  readonly kind: ExecutionGraph['kind'];
  readonly rollup: Rollup; // agent-level rollup
  readonly sessions: readonly SessionFindings[];
  readonly gaps: readonly string[];
}
