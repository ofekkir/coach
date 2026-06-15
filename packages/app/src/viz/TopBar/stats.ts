import type {
  ExecutionGraph,
  ExecutionNode,
  GraphNode,
  InteractionExecution,
} from '@coach/pipeline';
import { resolveNode } from '@coach/pipeline';

// ════════════════════════════════════════════════════════════════════════════
// Top-bar aggregates — app-side presentation derived from the ExecutionGraph (the
// "presentation lives in the app" rule). Sums the loaded run's wall-clock, cost
// and step count for the stat group.
// ════════════════════════════════════════════════════════════════════════════

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

function durationOf(node: GraphNode): number {
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
    graph.kind === 'agent' ? graph.data.sessions[0] : graph.kind === 'session' ? graph.data : null;
  if (session == null) return null;
  const root = resolveNode(graph, session.root.id);
  if (root.type === 'session' && root.session_id !== '') {
    return root.session_id.slice(0, SHORT_ID_LEN);
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
  const allNodes = interactions.flatMap((i) => membersOf(i).flatMap(flatten));

  const durationMs = interactions.reduce(
    (sum, i) => sum + durationOf(resolveNode(graph, i.root.id)),
    0,
  );
  const costUsd = allNodes.reduce((sum, n) => {
    const c = resolveNode(graph, n.id);
    return sum + ('cost_usd' in c ? (c.cost_usd ?? 0) : 0);
  }, 0);
  const steps = interactions.reduce((sum, i) => sum + membersOf(i).length, 0);

  return { durationMs, costUsd, steps, breadcrumb: breadcrumbOf(graph, interactions.length) };
}
