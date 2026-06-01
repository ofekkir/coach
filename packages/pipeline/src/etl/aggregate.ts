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
  for (const node of nodesByTrace.flat()) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(node);
  }
  return result;
}

export const SYNTHETIC_AGENT_ID = 'agent-upload';

// Groups session-level node arrays by agent id for multi-session aggregation.
// Sessions with a user_id group under that id; sessions without one group under
// the shared synthetic agent id so they are never dropped.
export function groupSessionsByAgent(
  sessionNodeArrays: readonly (readonly TraceNode[])[],
): Map<string, TraceNode[][]> {
  const groups = new Map<string, TraceNode[][]>();
  for (const nodes of sessionNodeArrays) {
    const session = nodes.find((n) => n.type === 'session' && n.parent == null);
    const agentId = session?.user_id ?? SYNTHETIC_AGENT_ID;
    const group = groups.get(agentId) ?? [];
    group.push([...nodes]);
    groups.set(agentId, group);
  }
  return groups;
}

// Synthesizes an agent node and re-parents root session nodes under it.
// Uses user_id from the first root session if present; falls back to SYNTHETIC_AGENT_ID.
export function aggregateAgent(sessionNodes: readonly TraceNode[]): TraceNode[] {
  const session = sessionNodes.find((n) => n.type === 'session' && n.parent == null);
  const userId = session?.user_id ?? null;
  const agentId = userId != null ? agentNodeId(userId) : SYNTHETIC_AGENT_ID;

  const agentNode: TraceNode = {
    id: agentId,
    type: 'agent',
    ...(userId != null ? { user_id: userId } : {}),
  };

  const updated = sessionNodes.map((n) =>
    n.type === 'session' && n.parent == null ? { ...n, parent: agentId } : n,
  );

  return [agentNode, ...updated];
}
