import type { CanonicalNode } from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Execution graph — the deterministic mechanical skeleton produced from the
// trace. Lossless: every node carries its full CanonicalNode; no display text.
//
//   agent ▸ session ▸ interaction ▸ thread ▸ step
//
// The app derives all display text from the structured data.
// ════════════════════════════════════════════════════════════════════════════

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
 *  children live in `threads`, not under `root`). `userPrompt` is a synthesized
 *  node carrying the full prompt — the interaction's input / head of the spine,
 *  the goal source the agent's work responds to. It is NOT a step. Null when the
 *  interaction has no prompt text. */
export interface InteractionExecution {
  readonly root: ExecutionNode;
  readonly userPrompt: ExecutionNode | null;
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

// ── App-facing result ─────────────────────────────────────────────────────────

/** One visualisable result produced from the uploaded files (one per agent).
 *  `title` is the tab/agent label. */
export interface VizResult {
  readonly title: string;
  readonly data: ExecutionGraph;
}
