import type { ExecutionGraph, InteractionExecution } from '@coach/pipeline';

// ════════════════════════════════════════════════════════════════════════════
// Top-bar breadcrumb — app-side presentation derived from the ExecutionGraph (the
// "presentation lives in the app" rule). Labels the loaded run by agent / session
// / interaction scope.
// ════════════════════════════════════════════════════════════════════════════

export interface RunStats {
  readonly breadcrumb: readonly string[];
}

const SHORT_ID_LEN = 8;

function interactionsOf(graph: ExecutionGraph): readonly InteractionExecution[] {
  if (graph.kind === 'agent') return graph.data.sessions.flatMap((s) => s.interactions);
  if (graph.kind === 'session') return graph.data.interactions;
  return graph.data != null ? [graph.data] : [];
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
  return { breadcrumb: breadcrumbOf(graph, interactions.length) };
}
