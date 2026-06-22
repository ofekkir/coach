import type {
  CanonicalNode,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
} from '@coach/pipeline';
import { nodeData } from '@coach/pipeline';

// Why: these aggregates live app-side, not in @coach/pipeline — presentation is
// derived from the ExecutionGraph in the app layer, never baked into the pipeline.
// Node data must be looked up by id because tree/thread nodes carry only ids.

export interface RunStats {
  readonly durationMs: number;
  readonly costUsd: number;
  readonly steps: number;
  readonly breadcrumb: readonly string[];
}

const SHORT_ID_LEN = 8;

function interactionsOf(graph: ExecutionGraph): readonly InteractionExecution[] {
  if (graph.kind === 'agent') return graph.data.sessions.flatMap((s) => s.interactions);
  if (graph.kind === 'session') return graph.data.interactions;
  return graph.data != null ? [graph.data] : [];
}

function durationOf(node: CanonicalNode): number {
  return 'duration_ms' in node ? node.duration_ms : 0;
}

function flatten(node: ExecutionNode): ExecutionNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function membersOf(interaction: InteractionExecution): ExecutionNode[] {
  return interaction.threads.flatMap((t) => t.members);
}

function sessionShortId(graph: ExecutionGraph): string | null {
  const session =
    graph.kind === 'agent'
      ? graph.data.sessions[0]?.session
      : graph.kind === 'session'
        ? graph.data.session
        : null;
  if (session != null && session.sessionId !== '') {
    return session.sessionId.slice(0, SHORT_ID_LEN);
  }
  return null;
}

function breadcrumbOf(graph: ExecutionGraph, interactionCount: number): string[] {
  const crumbs = ['agent'];
  const shortId = sessionShortId(graph);
  if (shortId != null) crumbs.push(`session ${shortId}`);
  if (interactionCount === 1) crumbs.push('interaction 1');
  else if (interactionCount > 1) crumbs.push(`${String(interactionCount)} interactions`);
  return crumbs;
}

export function summarizeRun(graph: ExecutionGraph): RunStats {
  const interactions = interactionsOf(graph);
  const allNodeIds = interactions.flatMap((i) =>
    membersOf(i)
      .flatMap(flatten)
      .map((n) => n.id),
  );

  const durationMs = interactions.reduce(
    (sum, i) => sum + durationOf(nodeData(graph, i.interactionId)),
    0,
  );
  const costUsd = allNodeIds.reduce((sum, id) => {
    const node = nodeData(graph, id);
    return sum + ('cost_usd' in node ? (node.cost_usd ?? 0) : 0);
  }, 0);
  const steps = interactions.reduce((sum, i) => sum + membersOf(i).length, 0);

  return { durationMs, costUsd, steps, breadcrumb: breadcrumbOf(graph, interactions.length) };
}
