import type { CanonicalNode } from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Graph contract — the shared data shape produced by the two graph stages.
//
// This package ORGANIZES data; it does not decide how to render it. So nodes
// here are LOSSLESS (they carry the full CanonicalNode) and carry NO formatted
// presentation (no `labelLines`, no "+12ms" strings, no truncated titles). The
// app derives all display text from this structured data.
//
// Two graphs:
//   • EXECUTION (mechanical) — the deterministic skeleton from the trace:
//       agent ▸ session ▸ interaction ▸ thread ▸ step. No interpretation.
//   • SEMANTIC (inferred)    — Coach's interpreted layer laid over execution:
//       per interaction, the steps are grouped into segments (sub-goals). A
//       segment is a sequence of steps; a step is an inference or an action and
//       is ~1:1 with an execution node (an inference = one llm_request; an action
//       = one tool call plus its pre/post lifecycle). Expanding a step drills into
//       that single execution node and its children.
//
// The semantic graph reuses the SAME ExecutionNode object instances as the
// execution graph (structural sharing, not copies) — one source of truth.
// ════════════════════════════════════════════════════════════════════════════

// ── Shared structural primitives ──────────────────────────────────────────────

/** A directed edge between two nodes. `gapMs` is the signed time gap between
 *  steps (ms); the app formats it ("+12ms"). Ids are plain canonical ids — the
 *  app maps them to its own container/subgraph ids for layout. */
export interface GraphEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly gapMs?: number;
}

/** A node in the execution skeleton. Lossless: `canonical` carries every field
 *  from the trace; `id` is hoisted (== canonical.id) for layout/expansion keys.
 *  Display text is the app's job — derive it from `canonical`. */
export interface ExecutionNode {
  readonly id: string;
  readonly canonical: CanonicalNode;
  readonly children: readonly ExecutionNode[];
  readonly innerEdges: readonly GraphEdge[];
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
 *  children live in `threads`, not under `root`). */
export interface InteractionExecution {
  readonly root: ExecutionNode;
  readonly threads: readonly Thread[];
  readonly rootToThreadIds: readonly string[];
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

// ── Semantic graph (inferred) ─────────────────────────────────────────────────

/** A move is one unit of cognitive work from an inference's content block.
 *  `verb` is an open vocabulary (reason, plan, answer, summarize, generate,
 *  act, …); `blockType` is the structural discriminant from the trace. */
export interface Move {
  readonly verb: string;
  readonly blockType: 'thinking' | 'text' | 'tool_use';
}

/** A step — one inferred unit of behavior within an interaction, ~1:1 with an
 *  execution node. It WRAPS that single node (shared ref); expanding it drills
 *  into the node and its lifecycle children (tool.execution, hooks).
 *  - `kind: 'inference'` — an llm_request; `moves` are its moves (reason, plan,
 *    answer, act, …) and `verb` is undefined.
 *  - `kind: 'action'` — a tool call; `verb` is its extrinsic verb (e.g. "Edit",
 *    "Bash git") and `moves` is empty. */
export interface Step {
  readonly id: string;
  readonly kind: 'inference' | 'action';
  readonly moves: readonly Move[];
  readonly verb?: string;
  readonly execution: ExecutionNode;
}

/** A segment is one sub-goal within an interaction — a contiguous sequence of
 *  steps serving one end. Invariant: a segment always has at least one step (an
 *  empty segment is a bug). `label` is the (eventually inferred) sub-goal name;
 *  today a placeholder ("segment 1"). */
export interface Segment {
  readonly index: number;
  readonly label: string;
  readonly steps: readonly Step[];
}

/** A control-flow form for an interaction.
 *  query: one inference, end_turn, no actions. agentic: inference↔action loop. */
export type InteractionShape = 'query' | 'agentic';

/** The semantic layer for one thread: its steps grouped into segments.
 *  V1 simplification: segmentation runs per thread, so segments nest under the
 *  thread that owns them and threading is preserved. (The mental model's ideal —
 *  segments cross-cutting threads — is deferred until segmentation is real.) */
export interface ThreadSemantics {
  readonly id: string;
  readonly source: string;
  readonly segments: readonly Segment[];
}

/** The semantic layer for one interaction: its shape and its per-thread
 *  segmentation. Keyed back to the execution skeleton by `interactionId`. */
export interface InteractionSemantics {
  readonly interactionId: string;
  readonly shape: InteractionShape;
  readonly threads: readonly ThreadSemantics[];
}

/** The semantic graph. The upper levels (agent ▸ session ▸ interaction) are the
 *  shared execution skeleton; semantics attach at the interaction level. The app
 *  renders the skeleton from `GraphData.execution` and swaps each interaction's
 *  body for its threads → segments here (matched by `interactionId`). */
export interface SemanticGraph {
  readonly interactions: readonly InteractionSemantics[];
}

// ── App-facing bundle ─────────────────────────────────────────────────────────

/** Both graphs for one agent, ready for the renderer's two tabs. */
export interface GraphData {
  readonly execution: ExecutionGraph;
  readonly semantic: SemanticGraph;
}

/** One visualisable result produced from the uploaded files (one per agent).
 *  `title` is the tab/agent label. */
export interface VizResult {
  readonly title: string;
  readonly data: GraphData;
}
