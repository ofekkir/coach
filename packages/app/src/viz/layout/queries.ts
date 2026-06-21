import type {
  Agent,
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  InteractionAnalysis,
  Session,
  SessionExecution,
} from '@coach/pipeline';
import { analyzeGraph } from '@coach/pipeline';
import type { Edge } from '@xyflow/react';

import { placeAgent, sessionWidth } from './place-graph.ts';
import type { Ctx, RFNode } from './types.ts';
import { CANVAS_TOP, CENTERING_DIVISOR, NW, HG } from './types.ts';

// Degraded-graph synthesizers — produce the missing upper ENTITIES (not nodes) so
// layout always has an agent ▸ session to hang the interactions under.
function syntheticAgent(): Agent {
  return { id: '__agent__', userId: '' };
}

// Empty sessionId so the renderer falls back to a positional title.
function syntheticSession(): Session {
  return { id: '__session__', agentId: '__agent__', userId: '', sessionId: '' };
}

/** Normalizes any ExecutionGraph variant into a single AgentExecution by
 *  synthesizing the missing upper entities. The pipeline degrades to
 *  session/interaction when those levels are absent; layout always wants an agent. */
function toAgent(graph: ExecutionGraph): AgentExecution {
  if (graph.kind === 'agent') return graph.data;

  if (graph.kind === 'session') {
    return { agent: syntheticAgent(), sessions: [graph.data] };
  }

  const interactions: InteractionExecution[] = graph.data != null ? [graph.data] : [];
  const session: SessionExecution = { session: syntheticSession(), interactions };
  return { agent: syntheticAgent(), sessions: [session] };
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
    graph,
    analysisByInteraction: analysisByInteraction(graph),
    cx: Math.max(NW, totalSessionsW) / CENTERING_DIVISOR + CANVAS_TOP,
    expanded,
    selected,
    nodes: [],
    edges: [],
  };
  placeAgent(agent, ctx);
  return { nodes: ctx.nodes, edges: ctx.edges };
}

// Stage-7 analysis, indexed by interaction id for O(1) lookup during placement.
function analysisByInteraction(graph: ExecutionGraph): Map<string, InteractionAnalysis> {
  const interactions = analyzeGraph(graph).sessions.flatMap((s) => s.interactions);
  return new Map(interactions.map((i) => [i.interactionId, i]));
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
  return [interaction.interactionId, ...memberIds];
}

export function allExpandableIds(graph: ExecutionGraph): Set<string> {
  const agent = toAgent(graph);
  const sessionIds = agent.sessions.map((s) => s.session.id);
  const interactionExpandables = agent.sessions.flatMap((s) =>
    s.interactions.flatMap((i) => expandableInteractionIds(i)),
  );
  return new Set([agent.agent.id, ...sessionIds, ...interactionExpandables]);
}

export function agentRoot(graph: ExecutionGraph): string {
  return toAgent(graph).agent.id;
}

// The path of expandable ancestor ids — from the matched node up to the agent
// root — within a member's containment subtree, or null when the target is not
// in this subtree. Includes the target itself so focusing also opens its children.
function nodeSubtreePath(node: ExecutionNode, targetId: string): string[] | null {
  if (node.id === targetId) return [node.id];
  for (const child of node.children) {
    const sub = nodeSubtreePath(child, targetId);
    if (sub != null) return [node.id, ...sub];
  }
  return null;
}

function memberForestPath(members: readonly ExecutionNode[], targetId: string): string[] | null {
  for (const member of members) {
    const sub = nodeSubtreePath(member, targetId);
    if (sub != null) return sub;
  }
  return null;
}

function interactionPath(interaction: InteractionExecution, targetId: string): string[] | null {
  if (interaction.interactionId === targetId) return [interaction.interactionId];
  const members = interaction.threads.flatMap((thread) => thread.members);
  const sub = memberForestPath(members, targetId);
  return sub == null ? null : [interaction.interactionId, ...sub];
}

function sessionPath(session: SessionExecution, targetId: string): string[] | null {
  if (session.session.id === targetId) return [session.session.id];
  for (const interaction of session.interactions) {
    const sub = interactionPath(interaction, targetId);
    if (sub != null) return [session.session.id, ...sub];
  }
  return null;
}

/** Every expandable ancestor that must be open for `targetId` to render, plus the
 *  target itself — the set "focus" merges into the expanded state to reveal a node
 *  before centering on it. Returns null when the id is not in the graph. */
export function revealPath(graph: ExecutionGraph, targetId: string): Set<string> | null {
  const agent = toAgent(graph);
  if (agent.agent.id === targetId) return new Set([agent.agent.id]);
  for (const session of agent.sessions) {
    const sub = sessionPath(session, targetId);
    if (sub != null) return new Set([agent.agent.id, ...sub]);
  }
  return null;
}
