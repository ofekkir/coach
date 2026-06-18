import { nodeData, type ExecutionGraph, type InteractionExecution } from '../types.ts';
import { collectTreeIds, durationMs, type NodeRef } from './access.ts';
import { criticalPath, type CriticalPath } from './critical-path.ts';
import { longestStep, type Hotspot } from './hotspots.ts';
import { repetitions, type Repetition } from './repetition.ts';

// ════════════════════════════════════════════════════════════════════════════
// Findings — mechanical, curated derivations over the ENRICHED execution graph
// (stage 6 output). Every finding points back into the node table BY ID
// (`NodeRef`); it never embeds a `CanonicalNode`, so a finding set stays small
// enough to drop into an agent's context. The shape mirrors the graph's
// `agent ▸ session ▸ interaction` levels.
// ════════════════════════════════════════════════════════════════════════════

/** Cost/latency/token rollup over a scope (interaction, session, or agent). Only
 *  `llm_request` nodes carry cost/tokens; `llm_request` and `tool` carry duration. */
export interface Rollup {
  readonly wallMs: number; // the scope's wall-clock
  readonly llmCallDurationMs: number; // Σ llm_request.duration_ms
  readonly costUsd: number; // Σ llm_request.cost_usd
  readonly tokensIn: number; // Σ llm_request.tokens_in
  readonly tokensOut: number; // Σ llm_request.tokens_out
  readonly llmCalls: number;
  readonly toolCalls: number;
}

/** A query turn has no tool nodes; an agentic turn has ≥1. */
export type Shape = 'query' | 'agentic';

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

const EMPTY_ROLLUP: Rollup = {
  wallMs: 0,
  llmCallDurationMs: 0,
  costUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  llmCalls: 0,
  toolCalls: 0,
};

const GAPS = [
  'failed tool calls — no error/status field on ToolNode; failures live only in the consuming inference tool_result content. Needs a schema addition.',
  'retry vs. benign re-read — separating them needs a tool-mutation taxonomy (semantic, not mechanical). Only redundant_tool is emitted today.',
];

/** Mechanical findings over the ENRICHED execution graph (stage 6 output). Pure and
 *  graph-only: the live pipeline (stage 7), the MCP reading a persisted
 *  `06-enriched-graph.json`, and the app's pre-computed-load path all call this and
 *  get byte-identical results. Reads `semantics` only for `NodeRef.what`; every
 *  metric comes from the node table. */
export function deriveFindings(graph: ExecutionGraph): FindingSet {
  const sessions = sessionsOf(graph).map((s) =>
    sessionFindings(graph, s.sessionId, s.interactions),
  );
  return {
    kind: graph.kind,
    rollup: mergeRollups(sessions.map((s) => s.rollup)),
    sessions,
    gaps: GAPS,
  };
}

interface SessionInteractions {
  readonly sessionId: string;
  readonly interactions: readonly InteractionExecution[];
}

// Normalizes the three graph `kind`s to a flat session→interactions list so the
// rest is kind-agnostic — mirroring how the graph builder degrades gracefully.
function sessionsOf(graph: ExecutionGraph): readonly SessionInteractions[] {
  if (graph.kind === 'agent') {
    return graph.data.sessions.map((sv) => ({
      sessionId: sv.session.id,
      interactions: sv.interactions,
    }));
  }
  if (graph.kind === 'session') {
    return [{ sessionId: graph.data.session.id, interactions: graph.data.interactions }];
  }
  if (graph.data == null) return [];
  const sessionId = nodeData(graph, graph.data.interactionId).sessionId;
  return [{ sessionId, interactions: [graph.data] }];
}

function sessionFindings(
  graph: ExecutionGraph,
  sessionId: string,
  interactions: readonly InteractionExecution[],
): SessionFindings {
  const findings = interactions.map((i) => interactionFindings(graph, i));
  return {
    sessionId,
    rollup: mergeRollups(findings.map((f) => f.rollup)),
    shapeMix: tallyShapes(findings),
    interactions: findings,
  };
}

function interactionFindings(
  graph: ExecutionGraph,
  interaction: InteractionExecution,
): InteractionFindings {
  const ids = collectTreeIds(interaction.tree);
  const node = nodeData(graph, interaction.interactionId);
  return {
    interactionId: interaction.interactionId,
    sequence: node.type === 'interaction' ? node.sequence : 0,
    shape: shapeOf(graph, ids),
    rollup: rollupOf(graph, ids, durationMs(node)),
    longestStep: longestStep(graph, interaction),
    criticalPath: criticalPath(graph, interaction),
    repetitions: repetitions(graph, interaction),
    failures: [],
  };
}

function shapeOf(graph: ExecutionGraph, ids: readonly string[]): Shape {
  return ids.some((id) => nodeData(graph, id).type === 'tool') ? 'agentic' : 'query';
}

function rollupOf(graph: ExecutionGraph, ids: readonly string[], wallMs: number): Rollup {
  return ids.reduce<Rollup>((acc, id) => addNode(acc, graph, id), { ...EMPTY_ROLLUP, wallMs });
}

function addNode(acc: Rollup, graph: ExecutionGraph, id: string): Rollup {
  const node = nodeData(graph, id);
  if (node.type === 'tool') return { ...acc, toolCalls: acc.toolCalls + 1 };
  if (node.type !== 'llm_request') return acc;
  return {
    ...acc,
    llmCallDurationMs: acc.llmCallDurationMs + node.duration_ms,
    costUsd: acc.costUsd + (node.cost_usd ?? 0),
    tokensIn: acc.tokensIn + node.tokens_in,
    tokensOut: acc.tokensOut + node.tokens_out,
    llmCalls: acc.llmCalls + 1,
  };
}

function tallyShapes(findings: readonly InteractionFindings[]): Record<Shape, number> {
  return findings.reduce<Record<Shape, number>>(
    (acc, f) => ({ ...acc, [f.shape]: acc[f.shape] + 1 }),
    { query: 0, agentic: 0 },
  );
}

function mergeRollups(rollups: readonly Rollup[]): Rollup {
  return rollups.reduce<Rollup>(
    (acc, r) => ({
      wallMs: acc.wallMs + r.wallMs,
      llmCallDurationMs: acc.llmCallDurationMs + r.llmCallDurationMs,
      costUsd: acc.costUsd + r.costUsd,
      tokensIn: acc.tokensIn + r.tokensIn,
      tokensOut: acc.tokensOut + r.tokensOut,
      llmCalls: acc.llmCalls + r.llmCalls,
      toolCalls: acc.toolCalls + r.toolCalls,
    }),
    EMPTY_ROLLUP,
  );
}
