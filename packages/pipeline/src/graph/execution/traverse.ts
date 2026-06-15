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
// ExecutionNode in the tree. The structural shape (agent ▸ session ▸ interaction
// ▸ thread ▸ step) is walked in ONE place, so per-node passes (e.g. semantic
// enrichment, which rebuilds the `nodes` table) never re-implement the hierarchy
// walk. The tree itself is immutable here — node data lives in the graph's
// `nodes` table, so a transform mutates the table, not the tree.
//
// Container nodes (agent/session/interaction roots, the synthesized user prompt)
// are visited too; a visitor that only cares about leaf step types simply skips
// the others by id.
// ════════════════════════════════════════════════════════════════════════════

type ExecutionNodeVisitor = (node: ExecutionNode) => void;

function visitNode(node: ExecutionNode, visit: ExecutionNodeVisitor): void {
  visit(node);
  node.children.forEach((child) => {
    visitNode(child, visit);
  });
}

function visitThread(thread: Thread, visit: ExecutionNodeVisitor): void {
  thread.members.forEach((member) => {
    visitNode(member, visit);
  });
}

function visitInteraction(ix: InteractionExecution, visit: ExecutionNodeVisitor): void {
  visitNode(ix.root, visit);
  if (ix.userPrompt != null) visitNode(ix.userPrompt, visit);
  ix.threads.forEach((thread) => {
    visitThread(thread, visit);
  });
}

function visitSession(session: SessionExecution, visit: ExecutionNodeVisitor): void {
  visitNode(session.root, visit);
  session.interactions.forEach((ix) => {
    visitInteraction(ix, visit);
  });
}

function visitAgent(agent: AgentExecution, visit: ExecutionNodeVisitor): void {
  visitNode(agent.root, visit);
  agent.sessions.forEach((session) => {
    visitSession(session, visit);
  });
}

/** Calls `visit` on every ExecutionNode in the graph's tree. The `interaction`/
 *  null graph has no nodes to visit. */
export function forEachExecutionNode(graph: ExecutionGraph, visit: ExecutionNodeVisitor): void {
  if (graph.kind === 'agent') {
    visitAgent(graph.data, visit);
    return;
  }
  if (graph.kind === 'session') {
    visitSession(graph.data, visit);
    return;
  }
  if (graph.data == null) return;
  visitInteraction(graph.data, visit);
}
