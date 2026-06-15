import type {
  AgentExecution,
  AgentNode,
  ExecutionGraph,
  ExecutionNode,
  GraphNode,
  InteractionExecution,
  SessionExecution,
  SessionNode,
} from '@coach/pipeline';
import { placeAgent, sessionWidth } from './place-graph.ts';
import type { Ctx, RFNode } from './types.ts';
import { CANVAS_TOP, CENTERING_DIVISOR, NW, HG } from './types.ts';
import type { Edge } from '@xyflow/react';

// App-synthesized roots used when the graph degrades to session/interaction —
// layout always wants a full agent ▸ session spine. Empty session_id so the
// renderer falls back to a positional title. Their data is added to the node
// table (see `nodeTable`); the tree references them by id only.
const SYNTH_AGENT: AgentNode = { id: '__agent__', type: 'agent', user_id: '' };
const SYNTH_SESSION: SessionNode = {
  id: '__session__',
  type: 'session',
  session_id: '',
  user_id: '',
};

function syntheticNode(id: string): ExecutionNode {
  return { id, children: [] };
}

/** The id→data table the layout resolves against: the graph's own nodes plus the
 *  synthesized agent/session roots. One source for both layout (`ctx.byId`) and
 *  the details panel's click lookup. */
export function nodeTable(graph: ExecutionGraph): Map<string, GraphNode> {
  const byId = new Map<string, GraphNode>();
  byId.set(SYNTH_AGENT.id, SYNTH_AGENT);
  byId.set(SYNTH_SESSION.id, SYNTH_SESSION);
  for (const [id, node] of Object.entries(graph.nodes)) byId.set(id, node);
  return byId;
}

/** Normalizes any ExecutionGraph variant into a single AgentExecution by
 *  synthesizing the missing upper levels. The pipeline degrades to
 *  session/interaction when those levels are absent; layout always wants an agent. */
function toAgent(graph: ExecutionGraph): AgentExecution {
  if (graph.kind === 'agent') return graph.data;

  if (graph.kind === 'session') {
    return { root: syntheticNode(SYNTH_AGENT.id), sessions: [graph.data] };
  }

  const interactions: InteractionExecution[] = graph.data != null ? [graph.data] : [];
  const session: SessionExecution = { root: syntheticNode(SYNTH_SESSION.id), interactions };
  return { root: syntheticNode(SYNTH_AGENT.id), sessions: [session] };
}

export function buildElements(
  graph: ExecutionGraph,
  expanded: Set<string>,
  selected: string | null,
): { nodes: RFNode[]; edges: Edge[] } {
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
    byId: nodeTable(graph),
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
