import type { GraphNode, RequestMessage, ResponseMessage } from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Execution graph — the deterministic mechanical skeleton produced from the
// trace. Lossless: every node carries its full GraphNode (a CanonicalNode, or
// its semantically-relabeled counterpart after enrichment); no display text.
//
//   agent ▸ session ▸ interaction ▸ thread ▸ step
//
// The app derives all display text from the structured data.
// ════════════════════════════════════════════════════════════════════════════

/** What a `GraphEdge` represents (structural containment is implicit in
 *  `ExecutionNode.children`, so it is not an edge kind):
 *  - `sequence`  — adjacent steps in time order (thread members, or a node's
 *                  ordered children). Carries NO `gapMs`: time-adjacency between
 *                  two steps is not causality, so a gap drawn there ("tool B
 *                  waited for tool A") is misleading.
 *  - `causal`    — the real dataflow DAG: an inference fanning out to a tool it
 *                  emitted, or a tool fanning in to the inference that consumed its
 *                  result. The signed `gapMs` lives here, where it means something
 *                  (and is often negative for fan-out under streamed dispatch). */
export type GraphEdgeKind = 'sequence' | 'causal';

/** A directed edge between two nodes. `gapMs` is the signed time gap (ms) — set
 *  only on `causal` edges; the app formats it ("+12ms"). Ids are plain canonical
 *  ids — the app maps them to its own container/subgraph ids for layout. */
export interface GraphEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: GraphEdgeKind;
  readonly gapMs?: number;
}

/** A node in the execution skeleton. Lossless: `canonical` carries every field
 *  from the trace; `id` is hoisted (== canonical.id) for layout/expansion keys.
 *  Display text is the app's job — derive it from `canonical`.
 *
 *  For `llm_request` nodes, `requestMessagesDelta` is the suffix of
 *  `canonical.request_messages` beyond the previous request in the same thread
 *  (the first request carries its full array). `responseMessagesDelta` is the
 *  full `canonical.response_messages` — each response is always all-new (not
 *  cumulative), so there is nothing to diff. Both fields are undefined on
 *  non-`llm_request` nodes. */
export interface ExecutionNode {
  readonly id: string;
  // Named `canonical` for the mechanical graph, but typed `GraphNode`: after the
  // semantic stage runs, a tool/llm_request step here holds its action/inference
  // relabel (a SemanticNode), which is not canonical. Not renamed to avoid churn.
  readonly canonical: GraphNode;
  readonly children: readonly ExecutionNode[];
  readonly innerEdges: readonly GraphEdge[];
  readonly requestMessagesDelta?: readonly RequestMessage[];
  readonly responseMessagesDelta?: readonly ResponseMessage[];
}

// ── Execution graph (mechanical) ──────────────────────────────────────────────

/** A thread is a mechanical execution lane within an interaction. `source` is
 *  the loop that emitted its inferences (e.g. "repl_main_thread"); the app
 *  renders the title from it. `members` are the steps (inference|action) in
 *  time order. */
export interface Thread {
  readonly id: string;
  readonly source: string;
  readonly members: readonly ExecutionNode[];
  readonly edges: readonly GraphEdge[];
}

/** One interaction's execution skeleton. `root` is the interaction node (its
 *  children live in `threads`, not under `root`). `userPrompt` is a synthesized
 *  node carrying the full prompt — the interaction's input / head of the spine,
 *  the goal source the agent's work responds to. It is NOT a step. Null when the
 *  interaction has no prompt text. */
export interface InteractionExecution {
  readonly root: ExecutionNode;
  readonly userPrompt: ExecutionNode | null;
  readonly threads: readonly Thread[];
  readonly rootToThreadIds: readonly string[];
  /** The causal dataflow overlay for this interaction: `inference → tool` (an
   *  inference emitted this tool call) and `tool → inference` (an inference
   *  consumed this tool's result). A DAG — one inference fans out to many tools
   *  and many tool results fan back into the next inference. Edges are derived
   *  from `tool_use_id` correlation, not timing; `gapMs` decorates them. Empty
   *  when the trace carries no tool-call ids. */
  readonly causalEdges: readonly GraphEdge[];
}

/** One session's execution skeleton. Titles are derived app-side from each
 *  interaction's `root.canonical` (prompt) or its position. */
export interface SessionExecution {
  readonly root: ExecutionNode;
  readonly interactions: readonly InteractionExecution[];
}

/** One agent's execution skeleton. */
export interface AgentExecution {
  readonly root: ExecutionNode;
  readonly sessions: readonly SessionExecution[];
}

/** The execution graph. Aggregation normally rolls everything under one agent,
 *  but the builder degrades gracefully to session/interaction when upper levels
 *  are absent. */
export type ExecutionGraph =
  | { readonly kind: 'agent'; readonly data: AgentExecution }
  | { readonly kind: 'session'; readonly data: SessionExecution }
  | { readonly kind: 'interaction'; readonly data: InteractionExecution | null };

// ── App-facing result ─────────────────────────────────────────────────────────

/** One visualisable result produced from the uploaded files (one per agent).
 *  `title` is the tab/agent label. */
export interface VizResult {
  readonly title: string;
  readonly data: ExecutionGraph;
}
