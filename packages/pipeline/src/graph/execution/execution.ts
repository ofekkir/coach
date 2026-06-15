import type { CanonicalNode, GraphNode, InteractionNode, UserPromptNode } from '../../types.ts';
import type {
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '../types.ts';
import { buildCausalEdges, type CanonResolver } from './causal.ts';
import {
  buildChildrenOf,
  buildThreadMembers,
  compareStart,
  messageKey,
  sortByStart,
  withLlmDeltas,
} from './thread.ts';

// ════════════════════════════════════════════════════════════════════════════
// Execution graph builder — the mechanical skeleton from a trace. Normalized:
// node data lives once in the graph's `nodes` table (see collectNodes); the tree
// and edges carry ids only. Stripped of presentation/semantics: raw signed gapMs
// (no "+12ms"), plain canonical edge ids, no segments/shape/moves/verbs.
// ════════════════════════════════════════════════════════════════════════════

// ── Recursive node building ─────────────────────────────────────────────────

function isInteraction(n: CanonicalNode): n is InteractionNode {
  return n.type === 'interaction';
}

function toExecutionNode(
  node: CanonicalNode,
  childrenOf: Map<string, CanonicalNode[]>,
): ExecutionNode {
  const rawChildren = childrenOf.get(node.id);
  if (rawChildren == null || rawChildren.length === 0) {
    return { id: node.id, children: [] };
  }

  const childNodes = sortByStart(rawChildren).map((child) => toExecutionNode(child, childrenOf));
  return { id: node.id, children: childNodes };
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

export function buildInteractionExecution(
  nodes: readonly CanonicalNode[],
): InteractionExecution | null {
  const interaction = nodes.find(isInteraction);
  if (interaction == null) return null;

  const childrenOf = buildChildrenOf(nodes);
  const directChildren = childrenOf.get(interaction.id) ?? [];
  const llmsByThread = groupLlmsByThread(directChildren);
  const threadMembers = buildThreadMembers(directChildren, llmsByThread);
  const sortedSources = orderSources(threadMembers, interaction);

  const root: ExecutionNode = { id: interaction.id, children: [] };

  const threads = sortedSources.map((source) =>
    buildThread(source, threadMembers.get(source) ?? [], childrenOf),
  );
  const userPrompt = toUserPromptNode(interaction);

  return {
    root,
    userPrompt,
    threads,
    rootToThreadIds: threads.map((t) => t.id),
    causalEdges: buildCausalEdges(threads, userPrompt, interactionResolver(nodes, interaction)),
  };
}

// Causal-edge building reads each node's data; the interaction's nodes plus its
// synthesized user_prompt form the local table to resolve ids against.
function interactionResolver(
  nodes: readonly CanonicalNode[],
  interaction: InteractionNode,
): CanonResolver {
  const byId = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
  const prompt = userPromptCanonical(interaction);
  if (prompt != null) byId.set(prompt.id, prompt);
  return (node) => {
    const found = byId.get(node.id);
    if (found == null) throw new Error(`interaction has no node with id: ${node.id}`);
    return found;
  };
}

// The user prompt is a synthesized first node of the interaction — its input /
// the head of the spine, carrying the full prompt. Mechanical, but not a step.
function userPromptCanonical(interaction: InteractionNode): UserPromptNode | null {
  if (interaction.prompt.trim() === '') return null;
  return {
    id: `${interaction.id}__prompt`,
    type: 'user_prompt',
    parent: interaction.id,
    prompt: interaction.prompt,
  };
}

function toUserPromptNode(interaction: InteractionNode): ExecutionNode | null {
  const canonical = userPromptCanonical(interaction);
  return canonical != null ? { id: canonical.id, children: [] } : null;
}

function buildThread(
  source: string,
  members: readonly CanonicalNode[],
  childrenOf: Map<string, CanonicalNode[]>,
): Thread {
  const seenMessageKeys = new Set<string>();
  const builtMembers = members.map((m) => {
    const base = toExecutionNode(m, childrenOf);
    const node = withLlmDeltas(base, m, seenMessageKeys);
    if (m.type === 'llm_request') {
      for (const msg of m.request_messages ?? []) {
        seenMessageKeys.add(messageKey(msg));
      }
    }
    return node;
  });

  return {
    id: `thread_${source.replace(/\W+/g, '_')}`,
    source,
    members: builtMembers,
  };
}

function emptyInteractionExecution(interaction: InteractionNode): InteractionExecution {
  return {
    root: { id: interaction.id, children: [] },
    userPrompt: toUserPromptNode(interaction),
    threads: [],
    rootToThreadIds: [],
    causalEdges: [],
  };
}

// ── Subtree extraction (ported from session-view.ts) ───────────────────────────

function nodeSubtree(nodes: readonly CanonicalNode[], rootId: string): CanonicalNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = buildChildrenOf(nodes);
  const result: CanonicalNode[] = [];
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id == null) continue;
    const node = byId.get(id);
    if (node == null) continue;
    result.push(node);
    for (const child of childrenOf.get(id) ?? []) {
      queue.push(child.id);
    }
  }
  return result;
}

// ── Session level ──────────────────────────────────────────────────────────────

function buildSessionExecution(nodes: readonly CanonicalNode[]): SessionExecution | null {
  const session = nodes.find((n) => n.type === 'session');
  if (session == null) return null;

  const childrenOf = buildChildrenOf(nodes);
  const interactions = sortByStart((childrenOf.get(session.id) ?? []).filter(isInteraction));
  if (interactions.length === 0) return null;

  const root: ExecutionNode = { id: session.id, children: [] };
  const interactionExecutions = interactions.map((interaction) => {
    const interactionNodes = nodeSubtree(nodes, interaction.id);
    return buildInteractionExecution(interactionNodes) ?? emptyInteractionExecution(interaction);
  });

  return { root, interactions: interactionExecutions };
}

function emptySessionExecution(session: CanonicalNode): SessionExecution {
  return {
    root: { id: session.id, children: [] },
    interactions: [],
  };
}

// ── Agent level ─────────────────────────────────────────────────────────────

function buildAgentExecution(nodes: readonly CanonicalNode[]): AgentExecution | null {
  const agent = nodes.find((n) => n.type === 'agent');
  if (agent == null) return null;

  const childrenOf = buildChildrenOf(nodes);
  const directSessions = (childrenOf.get(agent.id) ?? []).filter((n) => n.type === 'session');
  const sessions = sortByStart(directSessions);
  if (sessions.length === 0) return null;

  const root: ExecutionNode = { id: agent.id, children: [] };
  const sessionExecutions = sessions.map((session) => {
    const sessionNodes = nodeSubtree(nodes, session.id);
    return buildSessionExecution(sessionNodes) ?? emptySessionExecution(session);
  });

  return { root, sessions: sessionExecutions };
}

// ── Entry point — graceful degradation (ported from orchestrate.buildVizData) ──

// The graph's node table: every input node by id, plus the synthesized
// user_prompt node for each interaction (the only node not present in the input).
// The tree/edges reference these ids; the data lives here once.
function collectNodes(input: readonly CanonicalNode[]): Record<string, GraphNode> {
  const nodes: Record<string, GraphNode> = {};
  for (const node of input) {
    nodes[node.id] = node;
    const prompt = isInteraction(node) ? userPromptCanonical(node) : null;
    if (prompt != null) nodes[prompt.id] = prompt;
  }
  return nodes;
}

export function buildExecutionGraph(input: readonly CanonicalNode[]): ExecutionGraph {
  const nodes = collectNodes(input);

  const agent = buildAgentExecution(input);
  if (agent != null) return { kind: 'agent', data: agent, nodes };

  const session = buildSessionExecution(input);
  if (session != null) return { kind: 'session', data: session, nodes };

  return { kind: 'interaction', data: buildInteractionExecution(input), nodes };
}
