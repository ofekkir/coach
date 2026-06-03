import { SYNTHETIC_AGENT_ID, aggregateAgent, aggregateSession } from './aggregate/aggregate.ts';
import { toCanonical } from './canonical/canonical.ts';
import { classifyInputs } from './classify/classify.ts';
import { buildCausalGraphView } from './graph/view-model/graph-view.ts';
import {
  buildAgentCausalGraphView,
  buildSessionCausalGraphView,
} from './graph/view-model/session-view.ts';
import type { VizData } from './graph/view-model/types.ts';
import { routeToSessions } from './route/route.ts';
import type { CanonicalNode, ClassifiedInput, SessionInputs, UploadedFile } from './types.ts';

// ── Public types ──────────────────────────────────────────────────────────────

/** One visualisable result produced from the uploaded files. */
export interface VizResult {
  /** Short human-readable label for this result (used as a tab title). */
  title: string;
  /** The processed view-model data ready for the graph renderer. */
  data: VizData;
}

/**
 * The orchestrator's output: every pipeline stage's result, exposed as a member.
 * The CLI dumps these to disk for inspection; the app reads the graph members it
 * wants to render. `agentGraph` is itself a visualisable graph; `viewModel` is the
 * verb/move/segment view-model (one of several graphs we expect to add).
 */
export interface PipelineResult {
  classified: ClassifiedInput[]; // Stage 1 — every file tagged by type
  sessions: SessionInputs[]; // Stage 2 — supported inputs grouped by session
  canonicalBySession: { sessionId: string; nodes: CanonicalNode[] }[]; // Stage 3
  agentGraph: CanonicalNode[]; // Stage 4 — all sessions under one agent
  viewModel: VizData; // Stage 5 — view-model graph
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

function buildVizData(nodes: readonly CanonicalNode[]): VizData {
  const agentView = buildAgentCausalGraphView(nodes);
  if (agentView != null) return { kind: 'agent', data: agentView };
  const sessionView = buildSessionCausalGraphView(nodes);
  if (sessionView != null) return { kind: 'session', data: sessionView };
  return { kind: 'interaction', data: buildCausalGraphView(nodes) };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs the full pipeline over a flat list of in-memory files, returning every
 * stage's output. Pure and file-system-free — the CLI and the app both call it.
 *
 *   classify → route to sessions → to canonical (per session) → aggregate → view-model
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
  const viewModel = buildVizData(agentGraph);

  return { classified, sessions, canonicalBySession, agentGraph, viewModel };
}

/**
 * Thin adapter for the app's data-source seam: runs the pipeline and wraps the
 * view-model graph in the `VizResult` shape the renderer consumes. Always emits
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

  const agent = result.agentGraph.find((n) => n.type === 'agent' && n.id !== SYNTHETIC_AGENT_ID);
  const title = agent?.user_id ?? 'agent';
  return [{ title, data: result.viewModel }];
}
