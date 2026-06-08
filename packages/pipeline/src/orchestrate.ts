import { aggregateAgent, aggregateSession } from './aggregate/aggregate.ts';
import { toCanonical } from './canonical/canonical.ts';
import { classifyInputs } from './classify/classify.ts';
import { buildExecutionGraph } from './graph/execution/execution.ts';
import { startNs } from './graph/execution/thread.ts';
import type { ExecutionGraph, VizResult } from './graph/types.ts';
import { enrichExecutionGraph } from './graph/semantic/semantic.ts';
import type { LabelBatchFn } from './graph/semantic/semantic.ts';
import { routeToSessions } from './route/route.ts';
import type {
  AgentNode,
  CanonicalNode,
  ClassifiedInput,
  SessionInputs,
  UploadedFile,
} from './types.ts';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * The orchestrator's output: every pipeline stage's result, exposed as a member.
 * The CLI dumps these to disk for inspection; the app reads the graph member it
 * wants to render. Stage 5 builds the mechanical `executionGraph`; stage 6
 * (opt-in) builds `enrichedGraph` when a `labelBatch` callback is provided.
 */
export interface PipelineResult {
  classified: ClassifiedInput[]; // Stage 1 — every file tagged by type
  sessions: SessionInputs[]; // Stage 2 — supported inputs grouped by session
  canonicalBySession: { sessionId: string; nodes: CanonicalNode[] }[]; // Stage 3
  agentGraph: CanonicalNode[]; // Stage 4 — all sessions under one agent
  executionGraph: ExecutionGraph; // Stage 5 — mechanical skeleton
  enrichedGraph?: ExecutionGraph; // Stage 6 — semantic labels (present only when labelBatch was supplied)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sortByTime(nodes: readonly CanonicalNode[]): CanonicalNode[] {
  return [...nodes].sort((a, b) => {
    const aStart = startNs(a);
    const bStart = startNs(b);
    if (!aStart && !bStart) return 0;
    if (!aStart) return -1;
    if (!bStart) return 1;
    const diff = BigInt(aStart) - BigInt(bStart);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs the full pipeline over a flat list of in-memory files, returning every
 * stage's output. Pure and file-system-free — the CLI and the app both call it.
 *
 *   classify → route to sessions → to canonical (per session) → aggregate →
 *   execution graph
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

  return { classified, sessions, canonicalBySession, agentGraph, executionGraph };
}

/**
 * Async variant of `runPipeline` that optionally runs stage 6 (semantic
 * enrichment). Pass `labelBatch` to convert tool/llm_request nodes into
 * semantically-labeled action/inference nodes; omit it to skip enrichment
 * entirely (no LLM calls). When enrichment runs, the result includes
 * `enrichedGraph`; otherwise that field is absent.
 */
export async function runPipelineAsync(
  files: readonly UploadedFile[],
  labelBatch?: LabelBatchFn,
): Promise<PipelineResult> {
  const base = runPipeline(files);
  if (labelBatch == null) return base;
  const enrichedGraph = await enrichExecutionGraph(base.executionGraph, labelBatch);
  return { ...base, enrichedGraph };
}

/**
 * Thin adapter for the app's data-source seam: runs the pipeline and wraps the
 * execution graph in the `VizResult` shape the renderer consumes. Always emits
 * one result (single agent), or none when no session was produced.
 */
export function buildVizResults(files: readonly UploadedFile[]): VizResult[] {
  const result = runPipeline(files);

  const unsupported = result.classified.filter((c) => c.type === 'unsupported').length;
  // eslint-disable-next-line no-console
  if (unsupported > 0) console.warn(`coach: ignored ${String(unsupported)} unsupported file(s)`);

  // No session node means nothing renderable (empty upload, or inputs that
  // resolved a session id but produced no canonical nodes — e.g. logs with no trace).
  if (!result.agentGraph.some((n) => n.type === 'session')) return [];

  const agent = result.agentGraph.find((n): n is AgentNode => n.type === 'agent');
  const title = agent?.user_id ?? 'agent';
  return [{ title, data: result.executionGraph }];
}

/**
 * Builds a VizResult directly from a pre-computed ExecutionGraph (e.g. loaded
 * from the e2e script's `05-execution-graph.json`), bypassing the full pipeline.
 */
export function buildVizResultFromExecutionGraph(graph: ExecutionGraph, title: string): VizResult {
  return { title, data: graph };
}
