import type { CanonicalNode, InteractionNode, SessionNode } from '../types.ts';

function sessionNodeId(sessionId: string): string {
  return `session-${sessionId}`;
}

function agentNodeId(userId: string): string {
  return `agent-${userId}`;
}

// Synthesizes a session node and re-parents root interaction nodes under it.
function isRootInteraction(n: CanonicalNode): n is InteractionNode {
  return n.type === 'interaction' && n.parent == null;
}

export function addSessionNode(nodes: readonly CanonicalNode[]): CanonicalNode[] {
  const interaction = nodes.find(isRootInteraction);
  if (interaction?.session_id == null) return [...nodes];

  const sessionId = interaction.session_id;
  const sessionId_nodeId = sessionNodeId(sessionId);

  const sessionNode: CanonicalNode = {
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
export function aggregateSession(
  nodesByTrace: readonly (readonly CanonicalNode[])[],
): CanonicalNode[] {
  const seen = new Set<string>();
  const result: CanonicalNode[] = [];
  for (const node of nodesByTrace.flat()) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(node);
  }
  return result;
}

export const SYNTHETIC_AGENT_ID = 'agent-upload';

// Synthesizes an agent node and re-parents root session nodes under it.
// Multi-agent is out of scope — every session rolls up under one agent.
// Uses user_id from the first root session if present; falls back to SYNTHETIC_AGENT_ID.
function isRootSession(n: CanonicalNode): n is SessionNode {
  return n.type === 'session' && n.parent == null;
}

export function aggregateAgent(sessionNodes: readonly CanonicalNode[]): CanonicalNode[] {
  const session = sessionNodes.find(isRootSession);
  const userId = session?.user_id ?? null;
  const agentId = userId != null ? agentNodeId(userId) : SYNTHETIC_AGENT_ID;

  const agentNode: CanonicalNode = {
    id: agentId,
    type: 'agent',
    ...(userId != null ? { user_id: userId } : {}),
  };

  const updated = sessionNodes.map((n) =>
    n.type === 'session' && n.parent == null ? { ...n, parent: agentId } : n,
  );

  return [agentNode, ...updated];
}
