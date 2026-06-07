import type { CanonicalNode } from '../../types.ts';
import type {
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  SessionExecution,
  Thread,
} from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Semantic enrichment stage — converts mechanical tool/llm_request nodes into
// semantically-labeled action/inference nodes using an injected LLM callback.
//
// Architecture constraint: this module is pure (no node:* imports). The claude
// subprocess adapter lives in scripts/claude-labeler.ts and is wired up only
// by the e2e script when --enrich is passed.
// ════════════════════════════════════════════════════════════════════════════

// ── Public types ──────────────────────────────────────────────────────────────

/** Compact summary of one node sent to the labeler for classification. */
export interface LabelRequest {
  id: string;
  kind: 'tool' | 'llm_request';
  name?: string;
  tool_input?: string;
  prompt?: string;
  response?: string;
}

/**
 * Injected async callback that labels a batch of nodes.
 * Returns a map from node id → one-liner "what" description.
 * Missing ids receive mechanical fallbacks (tool name or model id).
 */
export type LabelBatchFn = (requests: readonly LabelRequest[]) => Promise<Map<string, string>>;

// ── Request collection ────────────────────────────────────────────────────────

const TRUNCATE_LEN = 250;

function trunc(s: string): string {
  return s.length <= TRUNCATE_LEN ? s : s.slice(0, TRUNCATE_LEN) + '…';
}

function toRequest(canonical: CanonicalNode): LabelRequest | null {
  if (canonical.type === 'tool') {
    const req: LabelRequest = { id: canonical.id, kind: 'tool' };
    if (canonical.name != null) req.name = canonical.name;
    const rawInput = canonical.tool_input_json ?? canonical.tool_input;
    if (rawInput != null) req.tool_input = trunc(rawInput);
    return req;
  }
  if (canonical.type === 'llm_request') {
    const req: LabelRequest = { id: canonical.id, kind: 'llm_request' };
    if (canonical.request != null) req.prompt = trunc(canonical.request);
    if (canonical.response != null) req.response = trunc(canonical.response);
    return req;
  }
  return null;
}

function collectFromNode(node: ExecutionNode, acc: LabelRequest[]): void {
  const req = toRequest(node.canonical);
  if (req != null) acc.push(req);
  for (const child of node.children) collectFromNode(child, acc);
}

function collectFromThread(thread: Thread, acc: LabelRequest[]): void {
  for (const member of thread.members) collectFromNode(member, acc);
}

function collectFromInteraction(ix: InteractionExecution, acc: LabelRequest[]): void {
  for (const thread of ix.threads) collectFromThread(thread, acc);
}

function collectFromSession(session: SessionExecution, acc: LabelRequest[]): void {
  for (const ix of session.interactions) collectFromInteraction(ix, acc);
}

function collectRequests(graph: ExecutionGraph): LabelRequest[] {
  const acc: LabelRequest[] = [];
  if (graph.kind === 'agent') {
    for (const session of graph.data.sessions) collectFromSession(session, acc);
  } else if (graph.kind === 'session') {
    collectFromSession(graph.data, acc);
  } else if (graph.data != null) {
    collectFromInteraction(graph.data, acc);
  }
  return acc;
}

// ── Node conversion ───────────────────────────────────────────────────────────

function mechanicalLabel(canonical: CanonicalNode): string {
  if (canonical.type === 'tool') return canonical.name ?? 'tool';
  if (canonical.type === 'llm_request') return canonical.model ?? 'llm_request';
  return canonical.type;
}

function convertCanonical(canonical: CanonicalNode, what: string | undefined): CanonicalNode {
  const label = what ?? mechanicalLabel(canonical);
  if (canonical.type === 'tool') return { ...canonical, type: 'action', what: label };
  if (canonical.type === 'llm_request') return { ...canonical, type: 'inference', what: label };
  return canonical;
}

function convertNode(node: ExecutionNode, labels: Map<string, string>): ExecutionNode {
  return {
    ...node,
    canonical: convertCanonical(node.canonical, labels.get(node.id)),
    children: node.children.map((c) => convertNode(c, labels)),
  };
}

function convertThread(thread: Thread, labels: Map<string, string>): Thread {
  return { ...thread, members: thread.members.map((m) => convertNode(m, labels)) };
}

function convertInteraction(
  ix: InteractionExecution,
  labels: Map<string, string>,
): InteractionExecution {
  return { ...ix, threads: ix.threads.map((t) => convertThread(t, labels)) };
}

function convertSession(session: SessionExecution, labels: Map<string, string>): SessionExecution {
  return {
    ...session,
    interactions: session.interactions.map((ix) => convertInteraction(ix, labels)),
  };
}

function applyLabels(graph: ExecutionGraph, labels: Map<string, string>): ExecutionGraph {
  if (graph.kind === 'agent') {
    const data: AgentExecution = {
      root: graph.data.root,
      sessions: graph.data.sessions.map((s) => convertSession(s, labels)),
    };
    return { kind: 'agent', data };
  }
  if (graph.kind === 'session') {
    return { kind: 'session', data: convertSession(graph.data, labels) };
  }
  if (graph.data == null) return graph;
  return { kind: 'interaction', data: convertInteraction(graph.data, labels) };
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Enriches an ExecutionGraph by converting mechanical tool/llm_request nodes
 * into semantically-labeled action/inference nodes.
 *
 * The graph structure (hierarchy, ids, edges) is preserved exactly — only the
 * node payloads change. All other node types pass through unchanged.
 * `labelBatch` receives compact per-node summaries and returns id → what labels;
 * missing ids receive mechanical fallbacks (tool name or model id).
 */
export async function enrichExecutionGraph(
  graph: ExecutionGraph,
  labelBatch: LabelBatchFn,
): Promise<ExecutionGraph> {
  const requests = collectRequests(graph);
  if (requests.length === 0) return graph;
  const labels = await labelBatch(requests);
  return applyLabels(graph, labels);
}
