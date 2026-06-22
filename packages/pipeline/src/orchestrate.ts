import { defaultSemanticsConfig, type SemanticsConfig } from '@coach/semantics';

import { aggregate, type AgentGraph } from './aggregate/aggregate.ts';
import { toCanonical } from './canonical/canonical.ts';
import { classifyInputs } from './classify/classify.ts';
import { buildExecutionGraph } from './graph/execution/execution.ts';
import { startNs } from './graph/execution/thread.ts';
import { enrichExecutionGraph } from './graph/semantic/semantic.ts';
import type { ExecutionGraph, VizResult } from './graph/types.ts';
import { routeToSessions } from './route/route.ts';
import type { CanonicalNode, ClassifiedInput, SessionInputs, UploadedFile } from './types.ts';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * The orchestrator's output: every pipeline stage's result, exposed as a member.
 * The CLI dumps these to disk for inspection; the app reads the graph member it
 * wants to render. Stage 5 builds the mechanical `executionGraph`; stage 6
 * (`enrichExecutionGraph`) layers deterministic semantic labels onto it.
 */
export interface PipelineResult {
  classified: ClassifiedInput[]; // Stage 1 — every file tagged by type
  sessions: SessionInputs[]; // Stage 2 — supported inputs grouped by session
  canonicalBySession: { sessionId: string; nodes: CanonicalNode[] }[]; // Stage 3
  agentGraph: AgentGraph; // Stage 4 — node table + agent/session entities
  executionGraph: ExecutionGraph; // Stage 5 — mechanical skeleton
  enrichedGraph: ExecutionGraph; // Stage 6 — deterministic semantic labels
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
 *   classify → route to sessions → to canonical (per session; tool results
 *   attached here) → aggregate → execution graph → semantic enrichment
 *
 * Stage 6 enrichment is deterministic and always runs, using `config` (the
 * bundled `defaultSemanticsConfig` unless overridden) — it is the final stage.
 * Curated analysis is deliberately NOT a pipeline stage: every rollup it would
 * compute is a one-line query over the materialized tables (see @coach/mcp).
 * Multi-agent is out of scope: all sessions roll up under a single agent.
 */
export function runPipeline(
  files: readonly UploadedFile[],
  config: SemanticsConfig = defaultSemanticsConfig,
): PipelineResult {
  const classified = classifyInputs(files);
  const sessions = routeToSessions(classified);

  const canonicalBySession = sessions.map((session) => ({
    sessionId: session.sessionId,
    nodes: sortByTime(toCanonical(session)),
  }));

  const agentGraph = aggregate(canonicalBySession.map((c) => c.nodes));
  const executionGraph = buildExecutionGraph(agentGraph);
  const enrichedGraph = enrichExecutionGraph(executionGraph, config);

  return {
    classified,
    sessions,
    canonicalBySession,
    agentGraph,
    executionGraph,
    enrichedGraph,
  };
}

/**
 * Builds a VizResult directly from a pre-computed ExecutionGraph (e.g. loaded
 * from the e2e script's `05-execution-graph.json`), bypassing the full pipeline.
 */
export function buildVizResultFromExecutionGraph(graph: ExecutionGraph, title: string): VizResult {
  return { title, data: graph };
}
