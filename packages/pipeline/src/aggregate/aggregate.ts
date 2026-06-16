import { agentEntityId, PSEUDO_USER_ID } from '../types.ts';
import type { Agent, CanonicalNode, InteractionNode, Session } from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Stage 4 — aggregate every session's canonical nodes into one node table plus
// the owning ENTITIES (one Agent, one Session per harness session). Agent and
// session are dimension rows referenced by FK, NOT graph nodes: the node table
// carries no `agent`/`session` rows, only the `sessionId` FK denormalized onto
// each node by stage 3. Multi-agent is out of scope — every session rolls up
// under one agent.
// ════════════════════════════════════════════════════════════════════════════

/** Stage 4 output: the node-data table plus the entity tables it references. Maps
 *  1:1 to `nodes` + `agents` + `sessions`. */
export interface AgentGraph {
  readonly nodes: readonly CanonicalNode[];
  readonly agent: Agent;
  readonly sessions: readonly Session[];
}

// Merges node arrays from multiple traces into a single node table; duplicates
// (same id) are dropped.
function dedupeById(nodesByTrace: readonly (readonly CanonicalNode[])[]): CanonicalNode[] {
  const seen = new Set<string>();
  const result: CanonicalNode[] = [];
  for (const node of nodesByTrace.flat()) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(node);
  }
  return result;
}

function interactionNodes(nodes: readonly CanonicalNode[]): InteractionNode[] {
  return nodes.filter((n): n is InteractionNode => n.type === 'interaction');
}

function buildAgent(interactions: readonly InteractionNode[]): Agent {
  const userId = interactions[0]?.user_id ?? PSEUDO_USER_ID;
  return { id: agentEntityId(userId), userId };
}

// One Session per distinct harness session id. The entity `id` is the value
// stamped on every node's `sessionId` FK (so node.sessionId === Session.id).
function buildSessions(interactions: readonly InteractionNode[], agentId: string): Session[] {
  const byHarnessId = new Map<string, Session>();
  for (const node of interactions) {
    if (byHarnessId.has(node.session_id)) continue;
    byHarnessId.set(node.session_id, {
      id: node.sessionId,
      agentId,
      userId: node.user_id,
      sessionId: node.session_id,
    });
  }
  return [...byHarnessId.values()];
}

export function aggregate(nodesByTrace: readonly (readonly CanonicalNode[])[]): AgentGraph {
  const nodes = dedupeById(nodesByTrace);
  const interactions = interactionNodes(nodes);
  const agent = buildAgent(interactions);
  return { nodes, agent, sessions: buildSessions(interactions, agent.id) };
}
