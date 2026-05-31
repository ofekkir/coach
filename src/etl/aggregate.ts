import type { TraceNode } from './types.ts';

function sessionNodeId(sessionId: string): string {
  return `session-${sessionId}`;
}

function agentNodeId(userId: string): string {
  return `agent-${userId}`;
}

// Synthesizes a session node and re-parents root interaction nodes under it.
export function addSessionNode(nodes: readonly TraceNode[]): TraceNode[] {
  const interaction = nodes.find((n) => n.type === 'interaction' && n.parent == null);
  if (interaction?.session_id == null) return [...nodes];

  const sessionId = interaction.session_id;
  const sessionId_nodeId = sessionNodeId(sessionId);

  const sessionNode: TraceNode = {
    id: sessionId_nodeId,
    type: 'session',
    session_id: sessionId,
    ...(interaction.user_id != null ? { user_id: interaction.user_id } : {}),
  };

  const updated = nodes.map((n) =>
    n.type === 'interaction' && n.parent == null ? { ...n, parent: sessionId_nodeId } : n,
  );

  return [sessionNode, ...updated];
}

// Merges node arrays from multiple traces into a single session-level forest.
// All trace arrays must share the same session node id; duplicates are dropped.
export function aggregateSession(nodesByTrace: readonly (readonly TraceNode[])[]): TraceNode[] {
  const seen = new Set<string>();
  const result: TraceNode[] = [];
  for (const nodes of nodesByTrace) {
    for (const node of nodes) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        result.push(node);
      }
    }
  }
  return result;
}

// Groups session-level node arrays by user_id for multi-session agent aggregation.
// Sessions without a user_id are dropped.
export function groupSessionsByAgent(
  sessionNodeArrays: readonly (readonly TraceNode[])[],
): Map<string, TraceNode[][]> {
  const groups = new Map<string, TraceNode[][]>();
  for (const nodes of sessionNodeArrays) {
    const session = nodes.find((n) => n.type === 'session' && n.parent == null);
    const userId = session?.user_id;
    if (userId == null) continue;
    const group = groups.get(userId) ?? [];
    group.push([...nodes]);
    groups.set(userId, group);
  }
  return groups;
}

// Synthesizes an agent node and re-parents root session nodes under it.
export function aggregateAgent(sessionNodes: readonly TraceNode[]): TraceNode[] {
  const session = sessionNodes.find((n) => n.type === 'session' && n.parent == null);
  if (session?.user_id == null) return [...sessionNodes];

  const userId = session.user_id;
  const agentId = agentNodeId(userId);

  const agentNode: TraceNode = {
    id: agentId,
    type: 'agent',
    user_id: userId,
  };

  const updated = sessionNodes.map((n) =>
    n.type === 'session' && n.parent == null ? { ...n, parent: agentId } : n,
  );

  return [agentNode, ...updated];
}
