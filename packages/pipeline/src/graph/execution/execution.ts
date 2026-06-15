import type { CanonicalNode, InteractionNode, UserPromptNode } from '../../types.ts';
import type {
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '../types.ts';
import { buildCausalEdges } from './causal.ts';
import {
  buildChildrenOf,
  buildThreadMembers,
  compareStart,
  messageKey,
  sortByStart,
  withLlmDeltas,
} from './thread.ts';

// ════════════════════════════════════════════════════════════════════════════
// Execution graph builder — the mechanical, lossless skeleton from a trace.
//
// Ported from view-model/{graph-view,session-view,thread}.ts but stripped of
// all presentation and semantics: nodes embed the full CanonicalNode (no
// labelLines), edges carry a raw signed gapMs (no "+12ms"), edge ids are plain
// canonical ids (no sg_ prefix), and there are no segments/shape/moves/verbs.
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
    return { id: node.id, canonical: node, children: [] };
  }

  const childNodes = sortByStart(rawChildren).map((child) => toExecutionNode(child, childrenOf));
  return { id: node.id, canonical: node, children: childNodes };
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

  const root: ExecutionNode = {
    id: interaction.id,
    canonical: interaction,
    children: [],
  };

  const threads = sortedSources.map((source) =>
    buildThread(source, threadMembers.get(source) ?? [], childrenOf),
  );
  const userPrompt = toUserPromptNode(interaction);

  return {
    root,
    userPrompt,
    threads,
    rootToThreadIds: threads.map((t) => t.id),
    causalEdges: buildCausalEdges(threads, userPrompt),
  };
}

// The user prompt is a synthesized first node of the interaction — its input /
// the head of the spine, carrying the full prompt. Mechanical, but not a step.
function toUserPromptNode(interaction: InteractionNode): ExecutionNode | null {
  if (interaction.prompt.trim() === '') return null;
  const canonical: UserPromptNode = {
    id: `${interaction.id}__prompt`,
    type: 'user_prompt',
    parent: interaction.id,
    prompt: interaction.prompt,
  };
  return { id: canonical.id, canonical, children: [] };
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
    root: { id: interaction.id, canonical: interaction, children: [] },
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

  const root: ExecutionNode = { id: session.id, canonical: session, children: [] };
  const interactionExecutions = interactions.map((interaction) => {
    const interactionNodes = nodeSubtree(nodes, interaction.id);
    return buildInteractionExecution(interactionNodes) ?? emptyInteractionExecution(interaction);
  });

  return { root, interactions: interactionExecutions };
}

function emptySessionExecution(session: CanonicalNode): SessionExecution {
  return {
    root: { id: session.id, canonical: session, children: [] },
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

  const root: ExecutionNode = { id: agent.id, canonical: agent, children: [] };
  const sessionExecutions = sessions.map((session) => {
    const sessionNodes = nodeSubtree(nodes, session.id);
    return buildSessionExecution(sessionNodes) ?? emptySessionExecution(session);
  });

  return { root, sessions: sessionExecutions };
}

// ── Entry point — graceful degradation (ported from orchestrate.buildVizData) ──

export function buildExecutionGraph(nodes: readonly CanonicalNode[]): ExecutionGraph {
  const agent = buildAgentExecution(nodes);
  if (agent != null) return { kind: 'agent', data: agent };

  const session = buildSessionExecution(nodes);
  if (session != null) return { kind: 'session', data: session };

  return { kind: 'interaction', data: buildInteractionExecution(nodes) };
}
