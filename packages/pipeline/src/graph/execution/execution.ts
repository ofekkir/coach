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

// ════════════════════════════════════════════════════════════════════════════
// Stage 5 — the mechanical, layered execution graph from the aggregated node
// table. Three concerns stay separate (see graph/types.ts): the `nodes` table
// (canonical data, additive), the `deltas` table (per-node message deltas built
// here), and the edge layers — containment (`tree`, ids only) and causal
// (`causalEdges`, a DAG). Entities (agent/session) own the structure; they are
// not nodes. Threads are a layout grouping only.
// ════════════════════════════════════════════════════════════════════════════

// Mutable accumulators threaded through the build: the node table (extended with
// synthesized user_prompt nodes) and the per-node deltas table.
interface BuildState {
  readonly nodes: Record<string, CanonicalNode>;
  readonly deltas: Record<string, MessageDeltas>;
  readonly childrenOf: Map<string, CanonicalNode[]>;
}

// The id-only containment tree rooted at `id`: each node carries only its id and
// its time-ordered children. No embedded data — resolve through the node table.
function buildTree(id: string, childrenOf: Map<string, CanonicalNode[]>): ExecutionNode {
  const raw = childrenOf.get(id) ?? [];
  return { id, children: sortByStart(raw).map((child) => buildTree(child.id, childrenOf)) };
}

// ── Interaction level ───────────────────────────────────────────────────────

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

// ── Session level ──────────────────────────────────────────────────────────────

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

// ── Entry point ──────────────────────────────────────────────────────────────

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
    intents: {},
  };
}
