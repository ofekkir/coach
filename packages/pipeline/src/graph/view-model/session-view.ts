import type { TraceNode } from '../../etl/types.ts';
import { buildLabelLines, sortByStart, truncate } from './format.ts';
import { buildCausalGraphView } from './graph-view.ts';
import { buildChildrenOf } from './thread.ts';
import type {
  AgentCausalGraphView,
  CausalGraphView,
  GraphViewNode,
  SessionCausalGraphView,
} from './types.ts';

function nodeSubtree(nodes: readonly TraceNode[], rootId: string): TraceNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = buildChildrenOf(nodes);
  const result: TraceNode[] = [];
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id == null) continue;
    const node = byId.get(id);
    if (node == null) continue;
    result.push(node);
    for (const child of childrenOf.get(id) ?? []) {
      queue.push(child.id);
    }
  }
  return result;
}

function buildEmptyInteractionView(interaction: TraceNode): CausalGraphView {
  return {
    root: {
      id: interaction.id,
      labelLines: buildLabelLines(interaction),
      children: [],
      innerEdges: [],
    },
    threads: [],
    rootToThreadIds: [],
    segments: [],
    shape: 'query',
  };
}

export function buildSessionCausalGraphView(
  nodes: readonly TraceNode[],
): SessionCausalGraphView | null {
  const session = nodes.find((n) => n.type === 'session');
  if (session == null) return null;

  const childrenOf = buildChildrenOf(nodes);
  const interactions = sortByStart(
    (childrenOf.get(session.id) ?? []).filter((n) => n.type === 'interaction'),
  );
  if (interactions.length === 0) return null;

  const root: GraphViewNode = {
    id: session.id,
    labelLines: buildLabelLines(session),
    children: [],
    innerEdges: [],
  };

  const interactionViews = interactions.map((interaction, i) => {
    const title =
      interaction.prompt != null
        ? truncate(interaction.prompt.replace(/\s+/g, ' '), 60)
        : `interaction ${String(i + 1)}`;
    const interactionNodes = nodeSubtree(nodes, interaction.id);
    const view = buildCausalGraphView(interactionNodes) ?? buildEmptyInteractionView(interaction);
    return { title, view };
  });

  return { root, interactions: interactionViews };
}

function buildEmptySessionView(session: TraceNode): SessionCausalGraphView {
  return {
    root: { id: session.id, labelLines: buildLabelLines(session), children: [], innerEdges: [] },
    interactions: [],
  };
}

export function buildAgentCausalGraphView(
  nodes: readonly TraceNode[],
): AgentCausalGraphView | null {
  const agent = nodes.find((n) => n.type === 'agent');
  if (agent == null) return null;

  const childrenOf = buildChildrenOf(nodes);
  const sessions = sortByStart(
    (childrenOf.get(agent.id) ?? []).filter((n) => n.type === 'session'),
  );
  if (sessions.length === 0) return null;

  const root: GraphViewNode = {
    id: agent.id,
    labelLines: buildLabelLines(agent),
    children: [],
    innerEdges: [],
  };

  const sessionViews = sessions.map((session, i) => {
    const title =
      session.session_id != null ? truncate(session.session_id, 40) : `session ${String(i + 1)}`;
    const sessionNodes = nodeSubtree(nodes, session.id);
    const view = buildSessionCausalGraphView(sessionNodes) ?? buildEmptySessionView(session);
    return { title, view };
  });

  return { root, sessions: sessionViews };
}
