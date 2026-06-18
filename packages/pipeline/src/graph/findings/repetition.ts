import type { ToolNode } from '../../types.ts';
import { nodeData, type ExecutionGraph, type InteractionExecution } from '../types.ts';
import { collectTreeIds, durationMs, toNodeRef, type NodeRef } from './access.ts';

// A repetition needs the original call plus at least one repeat.
const MIN_OCCURRENCES = 2;

/** Repeated identical work in one interaction. `redundant_tool` = same tool name +
 *  identical `tool_input` ≥2×. `wastedMs` sums the duration of every occurrence
 *  after the first. The repeated call is identified by its `occurrences` (resolve
 *  via `inspect_node`) and their stage-6 phrases — no derived signature is kept. */
export interface Repetition {
  readonly kind: 'redundant_tool' | 'retry_loop';
  readonly occurrences: readonly NodeRef[]; // ≥2, in time order
  readonly wastedMs: number;
}

function toolNodesInOrder(graph: ExecutionGraph, interaction: InteractionExecution): ToolNode[] {
  return collectTreeIds(interaction.tree)
    .map((id) => nodeData(graph, id))
    .filter((node): node is ToolNode => node.type === 'tool')
    .sort((a, b) => (a.start_time_ns < b.start_time_ns ? -1 : 1));
}

function groupByCall(tools: readonly ToolNode[]): Map<string, ToolNode[]> {
  const groups = new Map<string, ToolNode[]>();
  for (const tool of tools) {
    const key = `${tool.name ?? ''}:${tool.tool_input ?? ''}`;
    const list = groups.get(key);
    if (list != null) list.push(tool);
    else groups.set(key, [tool]);
  }
  return groups;
}

function toRepetition(graph: ExecutionGraph, tools: readonly ToolNode[]): Repetition {
  const [, ...rest] = tools;
  return {
    kind: 'redundant_tool',
    occurrences: tools.map((t) => toNodeRef(graph, t.id)),
    wastedMs: rest.reduce((sum, t) => sum + durationMs(t), 0),
  };
}

/** Redundant tool calls: the same tool name + identical `tool_input` run ≥2× in one
 *  interaction. (Separating a benign re-read from a genuine retry needs a tool-
 *  mutation taxonomy — semantic, not mechanical — so only `redundant_tool` is
 *  emitted today; see `gaps`.) */
export function repetitions(
  graph: ExecutionGraph,
  interaction: InteractionExecution,
): Repetition[] {
  return [...groupByCall(toolNodesInOrder(graph, interaction)).values()]
    .filter((tools) => tools.length >= MIN_OCCURRENCES)
    .map((tools) => toRepetition(graph, tools));
}
