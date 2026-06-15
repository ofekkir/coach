import type { GraphNode } from '../../types.ts';
import type { ExecutionNode, GraphEdge, Thread } from '../types.ts';
import { gapMsBetween } from './thread.ts';

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
//   wait       ─▶ execution   (within tool)  the gate released the run
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
}

function flatten(nodes: readonly ExecutionNode[]): ExecutionNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

// Pairs each PostToolUse:<name> hook to the most recent preceding tool of that
// name (hooks sit adjacent to their tool; they carry no tool_use_id to match on).
function pairPostHooksInGroup(
  group: readonly ExecutionNode[],
  postHookOf: Map<string, ExecutionNode>,
): void {
  const recentToolByName = new Map<string, ExecutionNode>();
  for (const node of group) {
    if (isCallableTool(node)) recentToolByName.set(toolName(node) ?? '', node);
    const hook = parseHook(node.canonical);
    if (hook?.event !== 'PostToolUse' || hook.toolName == null) continue;
    const tool = recentToolByName.get(hook.toolName);
    if (tool != null) postHookOf.set(tool.id, node);
  }
}

function indexPostHooks(
  orderedGroups: readonly (readonly ExecutionNode[])[],
): Map<string, ExecutionNode> {
  const postHookOf = new Map<string, ExecutionNode>();
  for (const group of orderedGroups) pairPostHooksInGroup(group, postHookOf);
  return postHookOf;
}

// The tool node that issues the call (carries tool_use_id), as opposed to its
// `tool.execution` sub-span.
function isCallableTool(node: ExecutionNode): boolean {
  return isToolLike(node.canonical) && node.canonical.type !== 'tool.execution';
}

function toolName(node: ExecutionNode): string | undefined {
  return 'name' in node.canonical ? node.canonical.name : undefined;
}

function buildIndex(threads: readonly Thread[]): CausalIndex {
  const all = flatten(threads.flatMap((t) => t.members));
  const emitterOf = new Map<string, ExecutionNode>();
  const toolOf = new Map<string, ExecutionNode>();
  for (const node of all) {
    const useId = isToolLike(node.canonical) ? toolUseIdOf(node.canonical) : undefined;
    if (useId != null) toolOf.set(useId, node);
    if (!isInference(node.canonical)) continue;
    for (const id of emittedToolUseIds(node)) emitterOf.set(id, node);
  }
  return { emitterOf, toolOf, postHookOf: indexPostHooks(threads.map((t) => t.members)) };
}

// ── Predecessor rules ───────────────────────────────────────────────────────────

function isPreHookFor(prev: ExecutionNode, tool: ExecutionNode): boolean {
  const hook = parseHook(prev.canonical);
  return hook?.event === 'PreToolUse' && hook.toolName === toolName(tool);
}

// What caused `node`. Tools: their PreToolUse hook if it directly precedes, else
// the inference that emitted them. Inferences: the tools they consumed (routed
// through each tool's PostToolUse hook when present); failing that — and for
// hooks, waits, executions — the previous sibling in time (`prev`).
function predecessorsOf(
  node: ExecutionNode,
  prev: ExecutionNode | null,
  index: CausalIndex,
): ExecutionNode[] {
  if (isCallableTool(node)) {
    if (prev != null && isPreHookFor(prev, node)) return [prev];
    const useId = toolUseIdOf(node.canonical);
    const emitter = useId != null ? index.emitterOf.get(useId) : undefined;
    return emitter != null ? [emitter] : continuation(prev);
  }
  if (isInference(node.canonical)) {
    const fanIn = fanInPredecessors(node, index);
    return fanIn.length > 0 ? fanIn : continuation(prev);
  }
  return continuation(prev);
}

function continuation(prev: ExecutionNode | null): ExecutionNode[] {
  return prev != null ? [prev] : [];
}

function fanInPredecessors(inference: ExecutionNode, index: CausalIndex): ExecutionNode[] {
  return consumedToolUseIds(inference).flatMap((useId) => {
    const tool = index.toolOf.get(useId);
    if (tool == null) return [];
    return [index.postHookOf.get(tool.id) ?? tool];
  });
}

// ── Recursive spine ──────────────────────────────────────────────────────────────

function edgeBetween(from: ExecutionNode, to: ExecutionNode): GraphEdge {
  const gapMs = gapMsBetween(from.canonical, to.canonical);
  return { fromId: from.id, toId: to.id, ...(gapMs !== null ? { gapMs } : {}) };
}

// Walks one time-ordered sibling group, linking each node to its cause and
// recursing into its children (headed by that node). `head` seeds the running
// predecessor — the userPrompt for a thread, the parent node for a sub-group.
function spineEdges(
  group: readonly ExecutionNode[],
  head: ExecutionNode | null,
  index: CausalIndex,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  let prev = head;
  for (const node of group) {
    for (const pred of predecessorsOf(node, prev, index)) edges.push(edgeBetween(pred, node));
    edges.push(...spineEdges(node.children, node, index));
    prev = node;
  }
  return edges;
}

/** The causal flow for one interaction (see InteractionExecution.causalEdges). */
export function buildCausalEdges(
  threads: readonly Thread[],
  userPrompt: ExecutionNode | null,
): GraphEdge[] {
  const index = buildIndex(threads);
  return threads.flatMap((thread) => spineEdges(thread.members, userPrompt, index));
}
