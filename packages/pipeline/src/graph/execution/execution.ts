import type { AgentGraph } from '../../aggregate/aggregate.ts';
import type { CanonicalNode, InteractionNode, MessageDeltas } from '../../types.ts';
import type { Session } from '../../types.ts';
import type {
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '../types.ts';

import { buildCausalEdges, type NodeResolver } from './causal.ts';
import {
  buildChildrenOf,
  buildThreadMembers,
  compareStart,
  llmDeltas,
  messageKey,
  sortByStart,
} from './thread.ts';

// Why: Stage 5 keeps three concerns separate (see graph/types.ts): the `nodes`
// table (canonical data, additive), the `deltas` table (per-node message deltas
// built here), and the edge layers — containment (`tree`, ids only) and causal
// (`causalEdges`, a DAG). Entities (agent/session) own the structure; they are
// not nodes. Threads are a layout grouping only.

// Why: nodes is extended in place with synthesized user_prompt nodes and deltas
// is populated as threads are built, so both accumulators are mutated through the
// recursion rather than rebuilt per level.
interface BuildState {
  readonly nodes: Record<string, CanonicalNode>;
  readonly deltas: Record<string, MessageDeltas>;
  readonly childrenOf: Map<string, CanonicalNode[]>;
}

// Why: the tree carries ids only, no embedded node data — callers resolve through
// the node table so canonical data lives in exactly one place.
function buildTree(id: string, childrenOf: Map<string, CanonicalNode[]>): ExecutionNode {
  const raw = childrenOf.get(id) ?? [];
  return { id, children: sortByStart(raw).map((child) => buildTree(child.id, childrenOf)) };
}

function groupLlmsByThread(directChildren: readonly CanonicalNode[]): Map<string, CanonicalNode[]> {
  const llmsByThread = new Map<string, CanonicalNode[]>();
  for (const n of directChildren) {
    if (n.type !== 'llm_request') continue;
    const src = n.source ?? 'unknown';
    const list = llmsByThread.get(src) ?? [];
    list.push(n);
    llmsByThread.set(src, list);
  }
  return llmsByThread;
}

function orderSources(
  threadMembers: Map<string, CanonicalNode[]>,
  fallback: CanonicalNode,
): string[] {
  return [...threadMembers.keys()].sort((a, b) => {
    const aFirst = threadMembers.get(a)?.[0];
    const bFirst = threadMembers.get(b)?.[0];
    return compareStart(aFirst ?? fallback, bFirst ?? fallback);
  });
}

function buildThread(source: string, members: readonly CanonicalNode[], state: BuildState): Thread {
  const seenMessageKeys = new Set<string>();
  const builtMembers = members.map((m) => {
    const deltas = llmDeltas(m, seenMessageKeys);
    if (deltas != null) state.deltas[m.id] = deltas;
    if (m.type === 'llm_request') {
      for (const msg of m.request_messages ?? []) seenMessageKeys.add(messageKey(msg));
    }
    return buildTree(m.id, state.childrenOf);
  });
  return { id: `thread_${source.replace(/\W+/g, '_')}`, source, members: builtMembers };
}

function resolverOf(state: BuildState): NodeResolver {
  return {
    node: (id) => {
      const node = state.nodes[id];
      if (node == null) throw new Error(`execution graph: no node data for id '${id}'`);
      return node;
    },
    deltas: (id) => state.deltas[id],
  };
}

function buildInteractionExecution(
  interaction: InteractionNode,
  state: BuildState,
): InteractionExecution {
  const directChildren = state.childrenOf.get(interaction.id) ?? [];
  const llmsByThread = groupLlmsByThread(directChildren);
  const threadMembers = buildThreadMembers(directChildren, llmsByThread);
  const sortedSources = orderSources(threadMembers, interaction);
  const threads = sortedSources.map((source) =>
    buildThread(source, threadMembers.get(source) ?? [], state),
  );

  return {
    interactionId: interaction.id,
    tree: buildTree(interaction.id, state.childrenOf),
    threads,
    causalEdges: buildCausalEdges(threads, resolverOf(state)),
  };
}

function buildSessionExecution(
  session: Session,
  allNodes: readonly CanonicalNode[],
  state: BuildState,
): SessionExecution {
  const interactions = sortByStart(
    allNodes.filter(
      (n): n is InteractionNode => n.type === 'interaction' && n.sessionId === session.id,
    ),
  );
  return {
    session,
    interactions: interactions.map((interaction) => buildInteractionExecution(interaction, state)),
  };
}

export function buildExecutionGraph(agentGraph: AgentGraph): ExecutionGraph {
  const nodes: Record<string, CanonicalNode> = {};
  for (const node of agentGraph.nodes) nodes[node.id] = node;

  const state: BuildState = {
    nodes,
    deltas: {},
    childrenOf: buildChildrenOf(agentGraph.nodes),
  };

  const data: AgentExecution = {
    agent: agentGraph.agent,
    sessions: agentGraph.sessions.map((session) =>
      buildSessionExecution(session, agentGraph.nodes, state),
    ),
  };

  return {
    kind: 'agent',
    data,
    nodes: state.nodes,
    deltas: state.deltas,
    semantics: {},
    actions: {},
    intents: {},
  };
}
