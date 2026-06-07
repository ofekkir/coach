import { SYNTHETIC_AGENT_ID, aggregateAgent, aggregateSession } from './aggregate/aggregate.ts';
import { toCanonical } from './canonical/canonical.ts';
import { classifyInputs } from './classify/classify.ts';
import { buildExecutionGraph } from './graph/execution/execution.ts';
import { buildSemanticGraph } from './graph/semantic/semantic.ts';
import type { ExecutionGraph, SemanticGraph, VizResult } from './graph/types.ts';
import { routeToSessions } from './route/route.ts';
import type { CanonicalNode, ClassifiedInput, SessionInputs, UploadedFile } from './types.ts';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * The orchestrator's output: every pipeline stage's result, exposed as a member.
 * The CLI dumps these to disk for inspection; the app reads the graph members it
 * wants to render. Stage 5 builds the mechanical `executionGraph`; stage 6 takes
 * that and builds the inferred `semanticGraph`.
 */
export interface PipelineResult {
  classified: ClassifiedInput[]; // Stage 1 — every file tagged by type
  sessions: SessionInputs[]; // Stage 2 — supported inputs grouped by session
  canonicalBySession: { sessionId: string; nodes: CanonicalNode[] }[]; // Stage 3
  agentGraph: CanonicalNode[]; // Stage 4 — all sessions under one agent
  executionGraph: ExecutionGraph; // Stage 5 — mechanical skeleton
  semanticGraph: SemanticGraph; // Stage 6 — inferred layer over the execution graph
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sortByTime(nodes: readonly CanonicalNode[]): CanonicalNode[] {
  return [...nodes].sort((a, b) => {
    if (!a.start_time_ns && !b.start_time_ns) return 0;
    if (!a.start_time_ns) return -1;
    if (!b.start_time_ns) return 1;
    const diff = BigInt(a.start_time_ns) - BigInt(b.start_time_ns);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs the full pipeline over a flat list of in-memory files, returning every
 * stage's output. Pure and file-system-free — the CLI and the app both call it.
 *
 *   classify → route to sessions → to canonical (per session) → aggregate →
 *   execution graph → semantic graph
 *
 * Multi-agent is out of scope: all sessions roll up under a single agent.
 */
export function runPipeline(files: readonly UploadedFile[]): PipelineResult {
  const classified = classifyInputs(files);
  const sessions = routeToSessions(classified);

  const canonicalBySession = sessions.map((session) => ({
    sessionId: session.sessionId,
    nodes: sortByTime(toCanonical(session)),
  }));

  const allSessionNodes = aggregateSession(canonicalBySession.map((c) => c.nodes));
  const agentGraph = aggregateAgent(allSessionNodes);
  const executionGraph = buildExecutionGraph(agentGraph);
  const semanticGraph = buildSemanticGraph(executionGraph);

  return { classified, sessions, canonicalBySession, agentGraph, executionGraph, semanticGraph };
}

/**
 * Thin adapter for the app's data-source seam: runs the pipeline and wraps both
 * graphs in the `VizResult` shape the renderer consumes. Always emits one result
 * (single agent), or none when no session was produced.
 */
export function buildVizResults(files: readonly UploadedFile[]): VizResult[] {
  const result = runPipeline(files);

  const unsupported = result.classified.filter((c) => c.type === 'unsupported').length;
  // eslint-disable-next-line no-console
  if (unsupported > 0) console.warn(`coach: ignored ${String(unsupported)} unsupported file(s)`);

  // No session node means nothing renderable (empty upload, or inputs that
  // resolved a session id but produced no canonical nodes — e.g. logs with no trace).
  if (!result.agentGraph.some((n) => n.type === 'session')) return [];

  const agent = result.agentGraph.find((n) => n.type === 'agent' && n.id !== SYNTHETIC_AGENT_ID);
  const title = agent?.user_id ?? 'agent';
  const data = { execution: result.executionGraph, semantic: result.semanticGraph };
  return [{ title, data }];
}

/**
 * Builds a VizResult directly from a pre-computed ExecutionGraph (e.g. loaded
 * from the e2e script's `05-execution-graph.json`). Derives the semantic graph
 * in-browser from the supplied execution graph — the full pipeline is skipped.
 */
export function buildVizResultFromExecutionGraph(graph: ExecutionGraph, title: string): VizResult {
  const semantic = buildSemanticGraph(graph);
  return { title, data: { execution: graph, semantic } };
}
