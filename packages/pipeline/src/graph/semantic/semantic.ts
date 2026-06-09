import type { GraphNode, LlmRequestNode, RequestMessage, ResponseMessage } from '../../types.ts';
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

/**
 * Compact summary of one node sent to the labeler. For `llm_request` nodes we
 * extract the semantically-relevant text rather than ship the raw message delta:
 * a small local model fixates on the noise (billing headers, base64 thinking
 * signatures, system reminders) and falls back to echoing a model id. The
 * deterministic cases (empty nodes, session-title calls) are short-circuited in
 * `planLabels` and never appear here.
 */
export interface LabelRequest {
  id: string;
  kind: 'tool' | 'llm_request';
  /** tool: the tool name. */
  name?: string;
  /** tool: the raw tool input (carries the intent — file path, url, query). */
  tool_input?: string;
  /** llm_request: text of the last user-role message (system messages stripped). */
  last_user_text?: string;
  /** llm_request: the first non-thinking text block the model emitted. */
  response_text?: string;
  /** llm_request: name of the tool this inference decided to invoke next, if any. */
  response_tool?: string;
}

/**
 * Injected async callback that labels a batch of nodes. Returns a map from node
 * id → ordered list of atomic action phrases. Missing ids receive mechanical
 * fallbacks (tool name or model id).
 */
export type LabelBatchFn = (
  requests: readonly LabelRequest[],
) => Promise<Map<string, readonly string[]>>;

// ── Deterministic short-circuits (no LLM) ───────────────────────────────────---
// Two node shapes are labeled without the model: nodes with no message delta at
// all (the model can only fabricate), and the harness's own session-title calls
// (an unambiguous {"title": …} response). Pre-classifying them both removes a
// large class of hallucinations and saves the round-trip.

const SESSION_TITLE_LABEL = 'generate session title';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isRecord)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}

function lastUserText(messages: readonly RequestMessage[]): string | undefined {
  const userMessages = messages.filter((m) => m.role === 'user');
  const last = userMessages[userMessages.length - 1];
  if (last == null) return undefined;
  const text = textFromContent(last.content).trim();
  return text === '' ? undefined : text;
}

function responseText(messages: readonly ResponseMessage[]): string | undefined {
  const block = messages.find((m) => m.type === 'text' && typeof m.text === 'string');
  const text = block != null ? String(block.text).trim() : '';
  return text === '' ? undefined : text;
}

function responseToolName(messages: readonly ResponseMessage[]): string | undefined {
  const block = messages.find((m) => m.type === 'tool_use' && typeof m.name === 'string');
  return block != null ? String(block.name) : undefined;
}

/** A session-title call returns a JSON object whose only meaningful key is `title`. */
function isSessionTitleResponse(text: string): boolean {
  if (!text.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && typeof parsed.title === 'string';
  } catch {
    return false;
  }
}

// ── Label planning ────────────────────────────────────────────────────────────

interface LabelPlan {
  requests: LabelRequest[];
  deterministic: Map<string, readonly string[]>;
}

interface LlmSignals {
  userText: string | undefined;
  respText: string | undefined;
  toolName: string | undefined;
}

function readLlmSignals(node: ExecutionNode): LlmSignals {
  const request = node.requestMessagesDelta;
  const response = node.responseMessagesDelta;
  return {
    userText: request != null ? lastUserText(request) : undefined,
    respText: response != null ? responseText(response) : undefined,
    toolName: response != null ? responseToolName(response) : undefined,
  };
}

function llmRequestFromSignals(id: string, signals: LlmSignals): LabelRequest {
  const req: LabelRequest = { id, kind: 'llm_request' };
  if (signals.userText != null) req.last_user_text = signals.userText;
  if (signals.respText != null) req.response_text = signals.respText;
  if (signals.toolName != null) req.response_tool = signals.toolName;
  return req;
}

function planLlmRequest(node: ExecutionNode, canonical: LlmRequestNode, plan: LabelPlan): void {
  const signals = readLlmSignals(node);
  if (signals.respText != null && isSessionTitleResponse(signals.respText)) {
    plan.deterministic.set(canonical.id, [SESSION_TITLE_LABEL]);
    return;
  }
  const hasSignal =
    signals.userText != null || signals.respText != null || signals.toolName != null;
  if (!hasSignal) {
    plan.deterministic.set(canonical.id, mechanicalLabel(canonical));
    return;
  }
  plan.requests.push(llmRequestFromSignals(canonical.id, signals));
}

function planNode(node: ExecutionNode, plan: LabelPlan): void {
  const canonical = node.canonical;
  if (canonical.type === 'tool') {
    const req: LabelRequest = { id: canonical.id, kind: 'tool' };
    if (canonical.name != null) req.name = canonical.name;
    if (canonical.tool_input != null) req.tool_input = canonical.tool_input;
    plan.requests.push(req);
  } else if (canonical.type === 'llm_request') {
    planLlmRequest(node, canonical, plan);
  }
  for (const child of node.children) planNode(child, plan);
}

function planThread(thread: Thread, plan: LabelPlan): void {
  for (const member of thread.members) planNode(member, plan);
}

function planInteraction(ix: InteractionExecution, plan: LabelPlan): void {
  for (const thread of ix.threads) planThread(thread, plan);
}

function planSession(session: SessionExecution, plan: LabelPlan): void {
  for (const ix of session.interactions) planInteraction(ix, plan);
}

function planLabels(graph: ExecutionGraph): LabelPlan {
  const plan: LabelPlan = { requests: [], deterministic: new Map() };
  if (graph.kind === 'agent') {
    for (const session of graph.data.sessions) planSession(session, plan);
  } else if (graph.kind === 'session') {
    planSession(graph.data, plan);
  } else if (graph.data != null) {
    planInteraction(graph.data, plan);
  }
  return plan;
}

// ── Node conversion ───────────────────────────────────────────────────────────

function mechanicalLabel(node: GraphNode): readonly string[] {
  if (node.type === 'tool') return [node.name ?? 'tool'];
  if (node.type === 'llm_request') return [node.model];
  return [node.type];
}

function convertCanonical(node: GraphNode, what: readonly string[] | undefined): GraphNode {
  const label = what ?? mechanicalLabel(node);
  if (node.type === 'tool') return { ...node, type: 'action', what: label };
  if (node.type === 'llm_request') return { ...node, type: 'inference', what: label };
  return node;
}

function convertNode(node: ExecutionNode, labels: Map<string, readonly string[]>): ExecutionNode {
  return {
    ...node,
    canonical: convertCanonical(node.canonical, labels.get(node.id)),
    children: node.children.map((c) => convertNode(c, labels)),
  };
}

function convertThread(thread: Thread, labels: Map<string, readonly string[]>): Thread {
  return { ...thread, members: thread.members.map((m) => convertNode(m, labels)) };
}

function convertInteraction(
  ix: InteractionExecution,
  labels: Map<string, readonly string[]>,
): InteractionExecution {
  return { ...ix, threads: ix.threads.map((t) => convertThread(t, labels)) };
}

function convertSession(
  session: SessionExecution,
  labels: Map<string, readonly string[]>,
): SessionExecution {
  return {
    ...session,
    interactions: session.interactions.map((ix) => convertInteraction(ix, labels)),
  };
}

function applyLabels(
  graph: ExecutionGraph,
  labels: Map<string, readonly string[]>,
): ExecutionGraph {
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
 * node payloads change. All other node types pass through unchanged. Empty nodes
 * and session-title calls are labeled deterministically; everything else goes to
 * `labelBatch`, which returns id → ordered action phrases. Missing ids receive
 * mechanical fallbacks (tool name or model id).
 */
export async function enrichExecutionGraph(
  graph: ExecutionGraph,
  labelBatch: LabelBatchFn,
): Promise<ExecutionGraph> {
  const plan = planLabels(graph);
  if (plan.requests.length === 0 && plan.deterministic.size === 0) return graph;
  const modelLabels =
    plan.requests.length > 0
      ? await labelBatch(plan.requests)
      : new Map<string, readonly string[]>();
  const labels = new Map<string, readonly string[]>([...plan.deterministic, ...modelLabels]);
  return applyLabels(graph, labels);
}
