import type { ToolNode } from '../../types.ts';
import { nodeData, type ExecutionGraph, type InteractionExecution } from '../types.ts';

/** The heaviest node by a metric, with its share of the scope total — `shareOfScope`
 *  is the fill fraction of the accent share-of-run bar the renderer draws.
 *  `nodeId` resolves through `graph.nodes` (or `inspect_node`, for an MCP). */
export interface Hotspot {
  readonly nodeId: string;
  readonly metric: 'latency' | 'cost' | 'tokens';
  readonly value: number;
  readonly shareOfScope: number; // value / scope total, 0..1
}

// The loop that emits the spine; every other thread is off-spine housekeeping.
const MAIN_THREAD_SOURCE = 'repl_main_thread';

/** The interaction's longest step by duration, taken over the main thread's
 *  top-level members — the node the renderer wears its accent on. `shareOfScope`
 *  is its fraction of the interaction's wall-clock. Null when nothing has duration.
 *
 *  Moved out of the app's `viz/layout/place-graph.ts` so the renderer and any
 *  other consumer (the MCP) read one derivation instead of recomputing it. */
export function longestStep(
  graph: ExecutionGraph,
  interaction: InteractionExecution,
): Hotspot | null {
  const main =
    interaction.threads.find((t) => t.source === MAIN_THREAD_SOURCE) ?? interaction.threads[0];
  if (main == null) return null;

  let id: string | undefined;
  let value = 0;
  for (const member of main.members) {
    const ms = nodeData(graph, member.id).duration_ms;
    if (ms <= value) continue;
    value = ms;
    id = member.id;
  }
  if (id == null || value === 0) return null;

  const wallMs = nodeData(graph, interaction.interactionId).duration_ms;
  return {
    nodeId: id,
    metric: 'latency',
    value,
    shareOfScope: wallMs > 0 ? value / wallMs : 0,
  };
}

// ── Failed edits by file — the "misleading file" signal ─────────────────────────
// A file the agent keeps failing to edit is one it is reasoning about with a stale
// or wrong mental model. We rebase the misleading-file signal on the now-matched
// tool result: count Edit/Write `tool` nodes with `is_error=true`, grouped by the
// `file_path` in their input, descending. (Reads were never the signal — only a
// rejected mutation tells you the model of the file was wrong.)

const EDITING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** A file with failed edits and the ids of the failing edit `tool` nodes (resolve
 *  through `graph.nodes` for `error_kind` / `result_summary`). */
export interface FailedFile {
  readonly path: string;
  readonly failedEditCount: number;
  readonly nodeIds: readonly string[];
}

function editedFilePath(tool: ToolNode): string | undefined {
  if (tool.tool_input == null) return undefined;
  try {
    const parsed: unknown = JSON.parse(tool.tool_input);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const path = (parsed as { file_path?: unknown }).file_path;
    return typeof path === 'string' ? path : undefined;
  } catch {
    return undefined;
  }
}

function isFailedEdit(tool: ToolNode): boolean {
  return tool.is_error === true && tool.name != null && EDITING_TOOLS.has(tool.name);
}

function tallyFailedEdits(tools: readonly ToolNode[]): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const tool of tools) {
    if (!isFailedEdit(tool)) continue;
    const path = editedFilePath(tool);
    if (path == null) continue;
    const ids = byPath.get(path) ?? [];
    ids.push(tool.id);
    byPath.set(path, ids);
  }
  return byPath;
}

/** Files (by path) with the most failed Edit/Write calls in a scope, descending. */
export function failedEditsByFile(tools: readonly ToolNode[]): FailedFile[] {
  return [...tallyFailedEdits(tools).entries()]
    .map(([path, nodeIds]) => ({ path, failedEditCount: nodeIds.length, nodeIds }))
    .sort((a, b) => b.failedEditCount - a.failedEditCount);
}
