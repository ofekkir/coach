import type { CanonicalNode, MessageDeltas } from '../../types.ts';
import type { CausalEdge, ExecutionNode, Thread } from '../types.ts';
import { gapMsBetween, startGapMsBetween } from './thread.ts';

// ════════════════════════════════════════════════════════════════════════════
// Causal-flow builder — THE causal edge layer (a DAG). Containment is a separate
// relation (the `tree`); time-adjacency is a layout grouping, not an edge.
//
// Tree/thread nodes are id-only, so this module resolves each node's data and
// message deltas through a `NodeResolver` (backed by the graph's `nodes`/`deltas`
// tables). Every step is linked to what CAUSED it, recovered structurally — never
// from raw timestamps:
//
//   userPrompt ─▶ inference                  the prompt triggered the turn
//   inference  ─▶ tool        (fan-out)      the response emitted this tool_use id
//   tool       ─▶ inference   (fan-in)       the request consumed this tool_result
//   inference  ─▶ inference   (continuation) a turn with no tool to bridge it
//   tool       ─▶ wait, exec  (within tool)  parallel sub-spans (they overlap)
//   inference ─▶ PreToolUse ─▶ tool ─▶ PostToolUse ─▶ inference   (hooks woven in)
//
// One inference fans out to many parallel tools, which fan back into the next.
// `gapMs` (signed; negative fan-out = dispatched mid-stream) decorates each edge.
// ════════════════════════════════════════════════════════════════════════════

/** Resolves a tree/thread node id to its canonical data and (stage-5) deltas. */
export interface NodeResolver {
  node(id: string): CanonicalNode;
  deltas(id: string): MessageDeltas | undefined;
}

function isInference(node: CanonicalNode): boolean {
  return node.type === 'llm_request';
}

function isToolLike(node: CanonicalNode): boolean {
  return node.type === 'tool';
}

function toolUseIdOf(node: CanonicalNode): string | undefined {
  return 'tool_use_id' in node ? node.tool_use_id : undefined;
}

interface HookEvent {
  readonly event: string;
  readonly toolName: string | null;
}

function parseHook(node: CanonicalNode): HookEvent | null {
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

function emittedToolUseIds(inference: ExecutionNode, r: NodeResolver): string[] {
  return (r.deltas(inference.id)?.responseMessagesDelta ?? [])
    .filter(isToolUseBlock)
    .map((block) => block.id);
}

function consumedToolUseIds(inference: ExecutionNode, r: NodeResolver): string[] {
  return (r.deltas(inference.id)?.requestMessagesDelta ?? []).flatMap((message) =>
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
  r: NodeResolver,
): void {
  const recentToolByName = new Map<string, ExecutionNode>();
  for (const node of group) {
    if (isCallableTool(node, r)) recentToolByName.set(toolName(node, r) ?? '', node);
    const hook = parseHook(r.node(node.id));
    if (hook?.event !== 'PostToolUse' || hook.toolName == null) continue;
    const tool = recentToolByName.get(hook.toolName);
    if (tool != null) postHookOf.set(tool.id, node);
  }
}

function indexPostHooks(
  orderedGroups: readonly (readonly ExecutionNode[])[],
  r: NodeResolver,
): Map<string, ExecutionNode> {
  const postHookOf = new Map<string, ExecutionNode>();
  for (const group of orderedGroups) pairPostHooksInGroup(group, postHookOf, r);
  return postHookOf;
}

// The tool node that issues the call (carries tool_use_id), as opposed to its
// `tool.execution` sub-span (a distinct node type, already excluded by isToolLike).
function isCallableTool(node: ExecutionNode, r: NodeResolver): boolean {
  return isToolLike(r.node(node.id));
}

function toolName(node: ExecutionNode, r: NodeResolver): string | undefined {
  const canonical = r.node(node.id);
  return 'name' in canonical ? canonical.name : undefined;
}

function buildIndex(threads: readonly Thread[], r: NodeResolver): CausalIndex {
  const all = flatten(threads.flatMap((t) => t.members));
  const emitterOf = new Map<string, ExecutionNode>();
  const toolOf = new Map<string, ExecutionNode>();
  for (const node of all) {
    const canonical = r.node(node.id);
    const useId = isToolLike(canonical) ? toolUseIdOf(canonical) : undefined;
    if (useId != null) toolOf.set(useId, node);
    if (!isInference(canonical)) continue;
    for (const id of emittedToolUseIds(node, r)) emitterOf.set(id, node);
  }
  return {
    emitterOf,
    toolOf,
    postHookOf: indexPostHooks(
      threads.map((t) => t.members),
      r,
    ),
    threadOf: indexThreadMembership(threads),
  };
}

// ── Predecessor rules ───────────────────────────────────────────────────────────

function isPreHookFor(prev: ExecutionNode, tool: ExecutionNode, r: NodeResolver): boolean {
  const hook = parseHook(r.node(prev.id));
  return hook?.event === 'PreToolUse' && hook.toolName === toolName(tool, r);
}

// What caused `node`. Tools: their PreToolUse hook if it directly precedes, else
// the inference that emitted them. Inferences: the tools they consumed (routed
// through each tool's PostToolUse hook when present); failing that — and for
// hooks, waits, executions — the previous sibling in time (`prev`).
function predecessorsOf(
  node: ExecutionNode,
  prev: ExecutionNode | null,
  index: CausalIndex,
  r: NodeResolver,
): ExecutionNode[] {
  const canonical = r.node(node.id);
  if (isCallableTool(node, r)) {
    if (prev != null && isPreHookFor(prev, node, r)) return [prev];
    const useId = toolUseIdOf(canonical);
    const emitter = useId != null ? index.emitterOf.get(useId) : undefined;
    return emitter != null ? [emitter] : continuation(prev);
  }
  if (isInference(canonical)) {
    const fanIn = fanInPredecessors(node, index, r);
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
function fanInPredecessors(
  inference: ExecutionNode,
  index: CausalIndex,
  r: NodeResolver,
): ExecutionNode[] {
  const thread = index.threadOf.get(inference.id);
  return consumedToolUseIds(inference, r).flatMap((useId) => {
    const tool = index.toolOf.get(useId);
    if (tool == null || index.threadOf.get(tool.id) !== thread) return [];
    return [index.postHookOf.get(tool.id) ?? tool];
  });
}

// ── Recursive spine ──────────────────────────────────────────────────────────────

// Containment edges (parent → its own child, e.g. tool → wait/execution) measure
// the gap from the parent's START — the child runs WITHIN the parent, so end-to-
// start would read misleadingly negative. Sequential edges use end-to-start.
function edgeBetween(from: ExecutionNode, to: ExecutionNode, r: NodeResolver): CausalEdge {
  const fromCanonical = r.node(from.id);
  const toCanonical = r.node(to.id);
  const nested = toCanonical.parent === from.id;
  const gapMs = nested
    ? startGapMsBetween(fromCanonical, toCanonical)
    : gapMsBetween(fromCanonical, toCanonical);
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
  r: NodeResolver,
  chainSiblings = true,
): CausalEdge[] {
  const edges: CausalEdge[] = [];
  let prev = head;
  for (const node of group) {
    for (const pred of predecessorsOf(node, prev, index, r)) edges.push(edgeBetween(pred, node, r));
    edges.push(...spineEdges(node.children, node, index, r, !isCallableTool(node, r)));
    if (chainSiblings) prev = node;
  }
  return edges;
}

/** The causal flow for one interaction (see InteractionExecution.causalEdges).
 *  `userPromptId` seeds the spine head — resolved through the node table. */
export function buildCausalEdges(
  threads: readonly Thread[],
  userPromptId: string | null,
  r: NodeResolver,
): CausalEdge[] {
  const index = buildIndex(threads, r);
  const head: ExecutionNode | null =
    userPromptId != null ? { id: userPromptId, children: [] } : null;
  return threads.flatMap((thread) => spineEdges(thread.members, head, index, r));
}
