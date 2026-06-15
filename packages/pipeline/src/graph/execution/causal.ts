import type { GraphNode } from '../../types.ts';
import type { ExecutionNode, GraphEdge, Thread } from '../types.ts';
import { gapMsBetween, startGapMsBetween } from './thread.ts';

/** Resolves a tree node to its data. The tree carries ids only; causal rules read
 *  node payloads (type, name, tool_use_id, timing), so every helper that inspects
 *  a node takes this resolver. */
export type CanonResolver = (node: ExecutionNode) => GraphNode;

// ════════════════════════════════════════════════════════════════════════════
// Causal-flow builder — THE edge layer of the execution graph (there is no
// "timeline"/sequence layer; member order is a layout grouping only).
//
// Every step is linked to what actually CAUSED it, recovered structurally —
// never from raw timestamps:
//
//   userPrompt ─▶ inference                  the prompt triggered the turn
//   inference  ─▶ tool        (fan-out)      the response emitted this tool_use id
//   tool       ─▶ inference   (fan-in)       the request consumed this tool_result
//   inference  ─▶ inference   (continuation) a turn with no tool to bridge it
//   tool       ─▶ wait, exec  (within tool)  parallel sub-spans (they overlap —
//                                            the wait does not precede execution)
//   inference ─▶ PreToolUse ─▶ tool ─▶ PostToolUse ─▶ inference   (hooks woven in)
//
// One inference fans out to many parallel tools, which fan back into the next —
// a DAG, not a tree. `gapMs` (signed; negative fan-out = dispatched mid-stream)
// decorates each edge.
//
// The spine is ONE recursive walk over time-ordered sibling groups: each node's
// predecessor is either id-based (tool↔inference, tool↔hook) or, failing that,
// the previous sibling in time (the prompt/continuation/wait→exec cases). A
// node's children are walked as a sub-group headed by that node, so within-tool
// sub-spans and nested sub-agent inferences are covered by the same rules.
// ════════════════════════════════════════════════════════════════════════════

function isInference(node: GraphNode): boolean {
  return node.type === 'llm_request' || node.type === 'inference';
}

function isToolLike(node: GraphNode): boolean {
  return node.type === 'tool' || node.type === 'action';
}

function toolUseIdOf(node: GraphNode): string | undefined {
  return 'tool_use_id' in node ? node.tool_use_id : undefined;
}

interface HookEvent {
  readonly event: string;
  readonly toolName: string | null;
}

function parseHook(node: GraphNode): HookEvent | null {
  if (node.type !== 'hook') return null;
  const i = node.name.indexOf(':');
  if (i === -1) return { event: node.name, toolName: null };
  return { event: node.name.slice(0, i), toolName: node.name.slice(i + 1) || null };
}

// ── Block extraction (typed; the message bodies are `unknown`) ──────────────────

function isToolUseBlock(block: { type: string }): block is { type: string; id: string } {
  return block.type === 'tool_use' && typeof (block as { id?: unknown }).id === 'string';
}

function isToolResultBlock(block: unknown): block is { type: 'tool_result'; tool_use_id: string } {
  if (typeof block !== 'object' || block === null) return false;
  const candidate = block as { type?: unknown; tool_use_id?: unknown };
  return candidate.type === 'tool_result' && typeof candidate.tool_use_id === 'string';
}

function emittedToolUseIds(inference: ExecutionNode): string[] {
  return (inference.responseMessagesDelta ?? []).filter(isToolUseBlock).map((block) => block.id);
}

function consumedToolUseIds(inference: ExecutionNode): string[] {
  return (inference.requestMessagesDelta ?? []).flatMap((message) =>
    Array.isArray(message.content)
      ? message.content.filter(isToolResultBlock).map((block) => block.tool_use_id)
      : [],
  );
}

// ── Correlation indexes (built once over every node, nested ones included) ──────

interface CausalIndex {
  readonly emitterOf: ReadonlyMap<string, ExecutionNode>; // tool_use_id → inference that emitted it
  readonly toolOf: ReadonlyMap<string, ExecutionNode>; // tool_use_id → the tool node
  readonly postHookOf: ReadonlyMap<string, ExecutionNode>; // tool node id → its PostToolUse hook
  readonly threadOf: ReadonlyMap<string, number>; // node id → its thread index (descendants included)
}

function indexThreadMembership(threads: readonly Thread[]): Map<string, number> {
  const threadOf = new Map<string, number>();
  threads.forEach((thread, i) => {
    flatten(thread.members).forEach((n) => threadOf.set(n.id, i));
  });
  return threadOf;
}

function flatten(nodes: readonly ExecutionNode[]): ExecutionNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

// Pairs each PostToolUse:<name> hook to the most recent preceding tool of that
// name (hooks sit adjacent to their tool; they carry no tool_use_id to match on).
function pairPostHooksInGroup(
  group: readonly ExecutionNode[],
  postHookOf: Map<string, ExecutionNode>,
  canon: CanonResolver,
): void {
  const recentToolByName = new Map<string, ExecutionNode>();
  for (const node of group) {
    if (isCallableTool(node, canon)) recentToolByName.set(toolName(node, canon) ?? '', node);
    const hook = parseHook(canon(node));
    if (hook?.event !== 'PostToolUse' || hook.toolName == null) continue;
    const tool = recentToolByName.get(hook.toolName);
    if (tool != null) postHookOf.set(tool.id, node);
  }
}

function indexPostHooks(
  orderedGroups: readonly (readonly ExecutionNode[])[],
  canon: CanonResolver,
): Map<string, ExecutionNode> {
  const postHookOf = new Map<string, ExecutionNode>();
  for (const group of orderedGroups) pairPostHooksInGroup(group, postHookOf, canon);
  return postHookOf;
}

// The tool node that issues the call (carries tool_use_id), as opposed to its
// `tool.execution` sub-span.
function isCallableTool(node: ExecutionNode, canon: CanonResolver): boolean {
  const c = canon(node);
  return isToolLike(c) && c.type !== 'tool.execution';
}

function toolName(node: ExecutionNode, canon: CanonResolver): string | undefined {
  const c = canon(node);
  return 'name' in c ? c.name : undefined;
}

function buildIndex(threads: readonly Thread[], canon: CanonResolver): CausalIndex {
  const all = flatten(threads.flatMap((t) => t.members));
  const emitterOf = new Map<string, ExecutionNode>();
  const toolOf = new Map<string, ExecutionNode>();
  for (const node of all) {
    const c = canon(node);
    const useId = isToolLike(c) ? toolUseIdOf(c) : undefined;
    if (useId != null) toolOf.set(useId, node);
    if (!isInference(c)) continue;
    for (const id of emittedToolUseIds(node)) emitterOf.set(id, node);
  }
  return {
    emitterOf,
    toolOf,
    postHookOf: indexPostHooks(
      threads.map((t) => t.members),
      canon,
    ),
    threadOf: indexThreadMembership(threads),
  };
}

// ── Predecessor rules ───────────────────────────────────────────────────────────

function isPreHookFor(prev: ExecutionNode, tool: ExecutionNode, canon: CanonResolver): boolean {
  const hook = parseHook(canon(prev));
  return hook?.event === 'PreToolUse' && hook.toolName === toolName(tool, canon);
}

// What caused `node`. Tools: their PreToolUse hook if it directly precedes, else
// the inference that emitted them. Inferences: the tools they consumed (routed
// through each tool's PostToolUse hook when present); failing that — and for
// hooks, waits, executions — the previous sibling in time (`prev`).
function predecessorsOf(
  node: ExecutionNode,
  prev: ExecutionNode | null,
  index: CausalIndex,
  canon: CanonResolver,
): ExecutionNode[] {
  if (isCallableTool(node, canon)) {
    if (prev != null && isPreHookFor(prev, node, canon)) return [prev];
    const useId = toolUseIdOf(canon(node));
    const emitter = useId != null ? index.emitterOf.get(useId) : undefined;
    return emitter != null ? [emitter] : continuation(prev);
  }
  if (isInference(canon(node))) {
    const fanIn = fanInPredecessors(node, index);
    return fanIn.length > 0 ? fanIn : continuation(prev);
  }
  return continuation(prev);
}

function continuation(prev: ExecutionNode | null): ExecutionNode[] {
  return prev != null ? [prev] : [];
}

// A tool result that appears in this inference's request is only a CAUSAL fan-in
// when both live in the same thread. A background loop (session-title, away-
// summary, …) carries the main thread's history in its requests, but it doesn't
// *consume* those tool results to continue — so cross-thread matches are skipped.
function fanInPredecessors(inference: ExecutionNode, index: CausalIndex): ExecutionNode[] {
  const thread = index.threadOf.get(inference.id);
  return consumedToolUseIds(inference).flatMap((useId) => {
    const tool = index.toolOf.get(useId);
    if (tool == null || index.threadOf.get(tool.id) !== thread) return [];
    return [index.postHookOf.get(tool.id) ?? tool];
  });
}

// ── Recursive spine ──────────────────────────────────────────────────────────────

// Containment edges (parent → its own child, e.g. tool → wait/execution) measure
// the gap from the parent's START — the child runs WITHIN the parent, so end-to-
// start would read misleadingly negative. Sequential edges use end-to-start.
function edgeBetween(from: ExecutionNode, to: ExecutionNode, canon: CanonResolver): GraphEdge {
  const fromCanon = canon(from);
  const toCanon = canon(to);
  const nested = 'parent' in toCanon && toCanon.parent === from.id;
  const gapMs = nested ? startGapMsBetween(fromCanon, toCanon) : gapMsBetween(fromCanon, toCanon);
  return { fromId: from.id, toId: to.id, ...(gapMs !== null ? { gapMs } : {}) };
}

// Walks one time-ordered sibling group, linking each node to its cause and
// recursing into its children (headed by that node). `head` seeds the running
// predecessor — the userPrompt for a thread, the parent node for a sub-group.
// `chainSiblings` is false for a tool's own sub-spans: its wait and execution
// start together (overlapping), so they are PARALLEL children of the tool, not a
// wait → execution sequence — each links to the tool head, not to each other.
function spineEdges(
  group: readonly ExecutionNode[],
  head: ExecutionNode | null,
  index: CausalIndex,
  canon: CanonResolver,
  chainSiblings = true,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  let prev = head;
  for (const node of group) {
    for (const pred of predecessorsOf(node, prev, index, canon)) {
      edges.push(edgeBetween(pred, node, canon));
    }
    edges.push(...spineEdges(node.children, node, index, canon, !isCallableTool(node, canon)));
    if (chainSiblings) prev = node;
  }
  return edges;
}

/** The causal flow for one interaction (see InteractionExecution.causalEdges). */
export function buildCausalEdges(
  threads: readonly Thread[],
  userPrompt: ExecutionNode | null,
  canon: CanonResolver,
): GraphEdge[] {
  const index = buildIndex(threads, canon);
  return threads.flatMap((thread) => spineEdges(thread.members, userPrompt, index, canon));
}
