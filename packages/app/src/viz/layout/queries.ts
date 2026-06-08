import type {
  AgentExecution,
  AgentNode,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  SessionExecution,
  SessionNode,
} from '@coach/pipeline';
import { placeAgent, sessionWidth } from './place-graph.ts';
import type { Ctx, TraceRFNode } from './types.ts';
import { CANVAS_TOP, CENTERING_DIVISOR, NW, HG } from './types.ts';
import type { Edge } from '@xyflow/react';

function synthetic(canonical: AgentNode | SessionNode): ExecutionNode {
  return { id: canonical.id, canonical, children: [], innerEdges: [] };
}

function syntheticAgent(): ExecutionNode {
  return synthetic({ id: '__agent__', type: 'agent' });
}

// Empty session_id so the renderer falls back to a positional title.
function syntheticSession(): ExecutionNode {
  return synthetic({ id: '__session__', type: 'session', session_id: '' });
}

/** Normalizes any ExecutionGraph variant into a single AgentExecution by
 *  synthesizing the missing upper levels. The pipeline degrades to
 *  session/interaction when those levels are absent; layout always wants an agent. */
function toAgent(graph: ExecutionGraph): AgentExecution {
  if (graph.kind === 'agent') return graph.data;

  if (graph.kind === 'session') {
    return { root: syntheticAgent(), sessions: [graph.data] };
  }

  const interactions: InteractionExecution[] = graph.data != null ? [graph.data] : [];
  const session: SessionExecution = { root: syntheticSession(), interactions };
  return { root: syntheticAgent(), sessions: [session] };
}

export function buildElements(
  graph: ExecutionGraph,
  expanded: Set<string>,
  selected: string | null,
): { nodes: TraceRFNode[]; edges: Edge[] } {
  const agent = toAgent(graph);
  const totalSessionsW = agent.sessions.reduce((sum, s, i) => {
    return sum + sessionWidth(s) + (i > 0 ? HG : 0);
  }, 0);
  const ctx: Ctx = {
    cx: Math.max(NW, totalSessionsW) / CENTERING_DIVISOR + CANVAS_TOP,
    expanded,
    selected,
    nodes: [],
    edges: [],
  };
  placeAgent(agent, ctx);
  return { nodes: ctx.nodes, edges: ctx.edges };
}

export function initialExpanded(): Set<string> {
  return new Set<string>();
}

// Every node id in the subtree that has children — at any depth — so "expand
// all" reaches nested calls (e.g. an llm_request inside a tool's execution).
function expandableSubtreeIds(node: ExecutionNode): string[] {
  if (node.children.length === 0) return [];
  return [node.id, ...node.children.flatMap(expandableSubtreeIds)];
}

function expandableInteractionIds(interaction: InteractionExecution): string[] {
  const memberIds = interaction.threads
    .flatMap((thread) => thread.members)
    .flatMap(expandableSubtreeIds);
  return [interaction.root.id, ...memberIds];
}

export function allExpandableIds(graph: ExecutionGraph): Set<string> {
  const agent = toAgent(graph);
  const sessionIds = agent.sessions.map((s) => s.root.id);
  const interactionExpandables = agent.sessions.flatMap((s) =>
    s.interactions.flatMap((i) => expandableInteractionIds(i)),
  );
  return new Set([agent.root.id, ...sessionIds, ...interactionExpandables]);
}

export function agentRoot(graph: ExecutionGraph): string {
  return toAgent(graph).root.id;
}
