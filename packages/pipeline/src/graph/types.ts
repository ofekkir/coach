import type { GraphNode, RequestMessage, ResponseMessage } from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Execution graph — the deterministic mechanical skeleton produced from the
// trace. Normalized: node data lives once in the graph's `nodes` table, keyed by
// id; the tree and edges carry ids only. Resolve a node's data with
// `resolveNode`. Lossless: each table entry is a full GraphNode (a CanonicalNode,
// or its semantically-relabeled counterpart after enrichment); no display text.
//
//   agent ▸ session ▸ interaction ▸ thread ▸ step
//
// The app derives all display text from the structured data.
// ════════════════════════════════════════════════════════════════════════════

/** A directed edge in the causal graph — the only edge layer. Time-adjacency
 *  ("step B is drawn under step A") is NOT modeled as an edge: it carries no
 *  causal meaning. Every edge here is a real dependency — an inference emitted
 *  this tool, a tool result fed this inference, a wait gated this execution, the
 *  prompt triggered this turn. `gapMs` is the signed gap between cause-end and
 *  effect-start (often negative for fan-out, when a tool is dispatched before its
 *  inference finishes streaming). Ids are plain canonical ids — the app maps them
 *  to its own container/subgraph ids for layout. */
export interface GraphEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly gapMs?: number;
}

/** A node in the execution skeleton. Holds only its `id` (a key into the graph's
 *  `nodes` table) and its children — resolve the node's data with `resolveNode`.
 *  Display text is the app's job — derive it from the resolved GraphNode.
 *
 *  For `llm_request` nodes, `requestMessagesDelta` is the suffix of the resolved
 *  node's `request_messages` beyond the previous request in the same thread (the
 *  first request carries its full array). `responseMessagesDelta` is the full
 *  `response_messages` — each response is always all-new (not cumulative), so
 *  there is nothing to diff. Both are position-dependent (they need thread
 *  ordering to compute) and so live on the tree node, NOT in the `nodes` table;
 *  both are undefined on non-`llm_request` nodes. */
export interface ExecutionNode {
  readonly id: string;
  readonly children: readonly ExecutionNode[];
  readonly requestMessagesDelta?: readonly RequestMessage[];
  readonly responseMessagesDelta?: readonly ResponseMessage[];
}

// ── Execution graph (mechanical) ──────────────────────────────────────────────

/** A thread is a mechanical execution lane within an interaction. `source` is
 *  the loop that emitted its inferences (e.g. "repl_main_thread"); the app
 *  renders the title from it. `members` are the steps (inference|action|hook) in
 *  time order — a layout grouping; the flow between them is the causal graph
 *  (`InteractionExecution.causalEdges`), not member order. */
export interface Thread {
  readonly id: string;
  readonly source: string;
  readonly members: readonly ExecutionNode[];
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
  /** The causal flow for this interaction — the complete spine, not an overlay:
   *  `userPrompt → first inference`, fan-out `inference → tool` (it emitted the
   *  call) and fan-in `tool → inference` (it consumed the result, by tool_use_id
   *  not timing), `inference → inference` continuation when no tool bridges them,
   *  a tool's overlapping sub-spans as parallel children (`tool → wait`,
   *  `tool → execution` — not a sequence), and tool hooks woven in
   *  (`inference → PreToolUse → tool → PostToolUse → inference`). A DAG: one
   *  inference fans out to many parallel tools, which fan back into the next.
   *  `gapMs` decorates each edge. */
  readonly causalEdges: readonly GraphEdge[];
}

/** One session's execution skeleton. Titles are derived app-side from each
 *  interaction root's resolved node (its prompt) or its position. */
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
 *  are absent.
 *
 *  `nodes` is the single source of node data: every id in the tree (and on every
 *  causal edge) resolves here to its full GraphNode. The tree/edges are pure
 *  structure (ids only), so a node serializes once and a step's data can be
 *  looked up by id without walking — use `resolveNode`. */
export type ExecutionGraph = {
  readonly nodes: Readonly<Record<string, GraphNode>>;
} & (
  | { readonly kind: 'agent'; readonly data: AgentExecution }
  | { readonly kind: 'session'; readonly data: SessionExecution }
  | { readonly kind: 'interaction'; readonly data: InteractionExecution | null }
);

/** Resolves a node id (from the tree or a causal edge) to its data in the graph's
 *  `nodes` table. Throws on an unknown id — the tree and table are built together,
 *  so a miss is a builder bug, not a data condition. */
export function resolveNode(graph: ExecutionGraph, id: string): GraphNode {
  const node = graph.nodes[id];
  if (node == null) throw new Error(`execution graph has no node with id: ${id}`);
  return node;
}

// ── App-facing result ─────────────────────────────────────────────────────────

/** One visualisable result produced from the uploaded files (one per agent).
 *  `title` is the tab/agent label. */
export interface VizResult {
  readonly title: string;
  readonly data: ExecutionGraph;
}
