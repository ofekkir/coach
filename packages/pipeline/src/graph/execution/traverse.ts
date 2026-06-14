import type {
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Execution-graph traversal — a single generic combinator that visits every
// ExecutionNode and rebuilds the graph from the mapper's results. The structural
// shape (agent ▸ session ▸ interaction ▸ thread ▸ step) is walked in ONE place,
// so per-node transforms (e.g. semantic enrichment) stay pure functions of a
// single node and never re-implement the hierarchy walk.
//
// Container nodes (agent/session/interaction roots, the synthesized user prompt)
// are visited too; a mapper that only cares about leaf step types simply returns
// them unchanged. Ids, edges, hierarchy, and thread metadata are preserved.
// ════════════════════════════════════════════════════════════════════════════

type ExecutionNodeMapper = (node: ExecutionNode) => ExecutionNode;

function mapNode(node: ExecutionNode, fn: ExecutionNodeMapper): ExecutionNode {
  const mapped = fn(node);
  if (mapped.children.length === 0) return mapped;
  return { ...mapped, children: mapped.children.map((child) => mapNode(child, fn)) };
}

function mapThread(thread: Thread, fn: ExecutionNodeMapper): Thread {
  return { ...thread, members: thread.members.map((member) => mapNode(member, fn)) };
}

function mapInteraction(ix: InteractionExecution, fn: ExecutionNodeMapper): InteractionExecution {
  return {
    ...ix,
    root: mapNode(ix.root, fn),
    userPrompt: ix.userPrompt != null ? mapNode(ix.userPrompt, fn) : null,
    threads: ix.threads.map((thread) => mapThread(thread, fn)),
  };
}

function mapSession(session: SessionExecution, fn: ExecutionNodeMapper): SessionExecution {
  return {
    ...session,
    root: mapNode(session.root, fn),
    interactions: session.interactions.map((ix) => mapInteraction(ix, fn)),
  };
}

function mapAgent(agent: AgentExecution, fn: ExecutionNodeMapper): AgentExecution {
  return {
    root: mapNode(agent.root, fn),
    sessions: agent.sessions.map((session) => mapSession(session, fn)),
  };
}

/**
 * Applies `fn` to every ExecutionNode in the graph and returns a structurally
 * identical graph built from the results. The `interaction`/null graph has no
 * nodes to visit and is returned by reference.
 */
export function mapExecutionNodes(graph: ExecutionGraph, fn: ExecutionNodeMapper): ExecutionGraph {
  if (graph.kind === 'agent') return { kind: 'agent', data: mapAgent(graph.data, fn) };
  if (graph.kind === 'session') return { kind: 'session', data: mapSession(graph.data, fn) };
  if (graph.data == null) return graph;
  return { kind: 'interaction', data: mapInteraction(graph.data, fn) };
}
