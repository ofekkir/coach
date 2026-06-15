import type { GraphNode } from '../../types.ts';
import type { ExecutionNode, GraphEdge, Thread } from '../types.ts';
import { gapMsBetween } from './thread.ts';

// ════════════════════════════════════════════════════════════════════════════
// Causal-edge builder — the dataflow DAG overlaying the thread lanes.
//
// Containment (who owns whom) and time-adjacency (who is drawn next) are NOT
// causality. The real edges are: an inference EMITTED a tool call (fan-out), and
// an inference CONSUMED a tool result (fan-in). Both are recovered structurally
// from `tool_use_id` correlation — never from timestamps:
//
//   • fan-out  inference → tool   : the inference's response carries a `tool_use`
//                                   block whose id matches the tool node.
//   • fan-in   tool → inference   : the inference's request newly carries a
//                                   `tool_result` block referencing the tool's id.
//
// One inference fans out to many parallel tools; many tool results fan back into
// the next inference — so this is a DAG, not a tree. `gapMs` decorates each edge
// (fan-out gaps are routinely negative: a tool can start before the inference
// span ends when the harness dispatches mid-stream).
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

// ── Block extraction (typed, no unsafe access on the unknown message bodies) ────

function isToolUseBlock(block: { type: string }): block is { type: string; id: string } {
  return block.type === 'tool_use' && typeof (block as { id?: unknown }).id === 'string';
}

function isToolResultBlock(block: unknown): block is { type: 'tool_result'; tool_use_id: string } {
  if (typeof block !== 'object' || block === null) return false;
  const candidate = block as { type?: unknown; tool_use_id?: unknown };
  return candidate.type === 'tool_result' && typeof candidate.tool_use_id === 'string';
}

/** tool_use ids the inference emitted — its fan-out targets. `responseMessagesDelta`
 *  is the full response (always all-new), so no cumulative filtering is needed. */
function emittedToolUseIds(inference: ExecutionNode): string[] {
  return (inference.responseMessagesDelta ?? []).filter(isToolUseBlock).map((block) => block.id);
}

/** tool_use ids whose results NEWLY entered this inference's request — its fan-in
 *  sources. Reads the delta (not cumulative `request_messages`) so only the tool
 *  results that actually triggered THIS inference produce edges. */
function consumedToolUseIds(inference: ExecutionNode): string[] {
  return (inference.requestMessagesDelta ?? []).flatMap((message) =>
    Array.isArray(message.content)
      ? message.content.filter(isToolResultBlock).map((block) => block.tool_use_id)
      : [],
  );
}

// ── Edge assembly ──────────────────────────────────────────────────────────────

function causalEdge(from: ExecutionNode, to: ExecutionNode): GraphEdge {
  const gapMs = gapMsBetween(from.canonical, to.canonical);
  return { fromId: from.id, toId: to.id, kind: 'causal', ...(gapMs !== null ? { gapMs } : {}) };
}

function fanOutEdges(
  inference: ExecutionNode,
  toolsByUseId: ReadonlyMap<string, ExecutionNode>,
): GraphEdge[] {
  return emittedToolUseIds(inference).flatMap((useId) => {
    const tool = toolsByUseId.get(useId);
    return tool != null ? [causalEdge(inference, tool)] : [];
  });
}

function fanInEdges(
  inference: ExecutionNode,
  toolsByUseId: ReadonlyMap<string, ExecutionNode>,
): GraphEdge[] {
  return consumedToolUseIds(inference).flatMap((useId) => {
    const tool = toolsByUseId.get(useId);
    return tool != null ? [causalEdge(tool, inference)] : [];
  });
}

function indexToolsByUseId(members: readonly ExecutionNode[]): Map<string, ExecutionNode> {
  const entries = members
    .filter((m) => isToolLike(m.canonical))
    .flatMap((m): [string, ExecutionNode][] => {
      const useId = toolUseIdOf(m.canonical);
      return useId != null ? [[useId, m]] : [];
    });
  return new Map(entries);
}

/** The causal DAG for one interaction. Empty when no tool node carries a
 *  `tool_use_id` (e.g. a trace that does not emit tool-call ids). */
export function buildCausalEdges(threads: readonly Thread[]): GraphEdge[] {
  const members = threads.flatMap((thread) => thread.members);
  const toolsByUseId = indexToolsByUseId(members);
  if (toolsByUseId.size === 0) return [];

  const inferences = members.filter((m) => isInference(m.canonical));
  const fanOut = inferences.flatMap((inf) => fanOutEdges(inf, toolsByUseId));
  const fanIn = inferences.flatMap((inf) => fanInEdges(inf, toolsByUseId));
  return [...fanOut, ...fanIn];
}
