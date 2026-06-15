import type { Agent, CanonicalNode, MessageDeltas, SemanticFields, Session } from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Execution graph — a normalized, stage-layered, id-keyed model that maps 1:1 to
// a relational DB. Three concerns are kept separate:
//
//   1. Node data is additive per stage, keyed by a shared node id:
//        stage 3 (canonical)  normalized node rows      → `nodes`
//        stage 5              per-node message deltas     → `deltas`
//        stage 6              per-node what + comment      → `semantics`
//   2. Edges are two different relations over the same nodes:
//        containment ("child is contained in time by parent") — the `parent`
//                     self-FK, surfaced as the `tree` (one parent per node).
//        causal      ("effect triggered by cause") — its own DAG edge set.
//   3. Agent and session are ENTITIES (dimension rows referenced by FK), never
//      graph nodes — they do not appear in the node-data table.
//
// A node "points to" its data by id, resolved through a table (`nodeData` /
// `deltasOf` / `semanticsOf` / `resolve`), never an embedded object. `node.id ==
// data.id`: one id namespace shared across every layer (1:1 joins).
// ════════════════════════════════════════════════════════════════════════════

// ── Edge layers ────────────────────────────────────────────────────────────────

/** A node in the CONTAINMENT tree ("contains", ordered): a parent contains the
 *  children that run within its time span. Id-only — the node's data lives in the
 *  `nodes` table, reached by `id`. (This is the `parent` self-FK surfaced as a
 *  tree: exactly one parent per node.) */
export interface ExecutionNode {
  readonly id: string;
  readonly children: readonly ExecutionNode[];
}

/** A directed edge in the CAUSAL graph ("triggers"), a DAG — the only edge layer
 *  with causal meaning. Time-adjacency ("step B is drawn under step A") is NOT an
 *  edge: it carries no causal meaning. Every edge here is a real dependency — an
 *  inference emitted this tool, a tool result fed this inference, a wait gated this
 *  execution, the prompt triggered this turn. `gapMs` is the signed gap between
 *  cause-end and effect-start (often negative for fan-out, when a tool is
 *  dispatched before its inference finishes streaming). Endpoints are plain node
 *  ids — the app maps them to its own container/subgraph ids for layout. */
export interface CausalEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly gapMs?: number;
}

// ── Composition — entities own the structure; the node-graph lives in an interaction

/** A thread is a layout grouping of an interaction's steps into an execution lane.
 *  `source` is the loop that emitted its inferences (e.g. "repl_main_thread"); the
 *  app renders the title from it. `members` are the steps in time order — adjacency
 *  is NOT causality (the causal flow is `InteractionExecution.causalEdges`). Members
 *  are id-only `ExecutionNode`s carrying their own containment children. */
export interface Thread {
  readonly id: string;
  readonly source: string;
  readonly members: readonly ExecutionNode[];
}

/** One interaction's execution skeleton, all keyed by node id.
 *  - `interactionId` — the interaction node (resolve via the `nodes` table).
 *  - `userPromptId` — the synthesized user-prompt node carrying the full prompt
 *    (the interaction's input / head of the spine, NOT a step). Null when the
 *    interaction has no prompt text.
 *  - `tree` — the CONTAINMENT tree rooted at the interaction (ids only).
 *  - `threads` — a LAYOUT grouping only (see `Thread`).
 *  - `causalEdges` — the CAUSAL flow (a DAG): `userPrompt → first inference`,
 *    fan-out `inference → tool`, fan-in `tool → inference` (by tool_use_id, not
 *    timing), `inference → inference` continuation, a tool's overlapping sub-spans
 *    as parallel children, and tool hooks woven in. */
export interface InteractionExecution {
  readonly interactionId: string;
  readonly userPromptId: string | null;
  readonly tree: ExecutionNode;
  readonly threads: readonly Thread[];
  readonly causalEdges: readonly CausalEdge[];
}

/** One session's execution skeleton. `session` is the owning entity (FK target),
 *  not a node. */
export interface SessionExecution {
  readonly session: Session;
  readonly interactions: readonly InteractionExecution[];
}

/** One agent's execution skeleton. `agent` is the owning entity, not a node. */
export interface AgentExecution {
  readonly agent: Agent;
  readonly sessions: readonly SessionExecution[];
}

// ── Execution graph ────────────────────────────────────────────────────────────

/** The execution graph: three id-keyed node-data tables (`nodes`, `deltas`,
 *  `semantics`) plus the edge/entity composition. Aggregation normally rolls
 *  everything under one agent, but the builder degrades gracefully to
 *  session/interaction when upper levels are absent. Plain JSON-serializable data:
 *  no classes, no cycles, ids as the only cross-refs — so it round-trips and drops
 *  straight into a relational store. */
export type ExecutionGraph = {
  readonly nodes: Readonly<Record<string, CanonicalNode>>;
  readonly deltas: Readonly<Record<string, MessageDeltas>>;
  readonly semantics: Readonly<Record<string, SemanticFields>>;
} & (
  | { readonly kind: 'agent'; readonly data: AgentExecution }
  | { readonly kind: 'session'; readonly data: SessionExecution }
  | { readonly kind: 'interaction'; readonly data: InteractionExecution | null }
);

// ── Resolvers — a node "points to" its data by id, resolved through a table ──────

/** The canonical node data for an id. Throws on a miss — a tree/thread/edge id that
 *  isn't in the node table is a pipeline bug, not a tolerable absence. */
export function nodeData(graph: ExecutionGraph, id: string): CanonicalNode {
  const node = graph.nodes[id];
  if (node == null) throw new Error(`execution graph: no node data for id '${id}'`);
  return node;
}

/** The stage-5 message deltas for an id, or undefined when the node has no row
 *  (every non-`llm_request` node). */
export function deltasOf(graph: ExecutionGraph, id: string): MessageDeltas | undefined {
  return graph.deltas[id];
}

/** The stage-6 semantic fields for an id, or undefined when the node was not
 *  relabeled (the absence IS the "not enriched" signal). */
export function semanticsOf(graph: ExecutionGraph, id: string): SemanticFields | undefined {
  return graph.semantics[id];
}

/** A node resolved across every layer by a single id. */
export interface ResolvedNode {
  node: CanonicalNode;
  deltas?: MessageDeltas;
  semantics?: SemanticFields;
}

/** Resolves a node id across all three tables in one call. */
export function resolve(graph: ExecutionGraph, id: string): ResolvedNode {
  const deltas = deltasOf(graph, id);
  const semantics = semanticsOf(graph, id);
  return {
    node: nodeData(graph, id),
    ...(deltas != null ? { deltas } : {}),
    ...(semantics != null ? { semantics } : {}),
  };
}

// ── App-facing result ─────────────────────────────────────────────────────────

/** One visualisable result produced from the uploaded files (one per agent).
 *  `title` is the tab/agent label. */
export interface VizResult {
  readonly title: string;
  readonly data: ExecutionGraph;
}
