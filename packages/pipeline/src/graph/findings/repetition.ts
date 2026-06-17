import type { ToolNode } from '../../types.ts';
import { nodeData, type ExecutionGraph, type InteractionExecution } from '../types.ts';
import { collectTreeIds, durationMs, hash, toNodeRef } from './access.ts';
import type { Repetition } from './types.ts';

// A repetition needs the original call plus at least one repeat.
const MIN_OCCURRENCES = 2;

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

/** Redundant tool calls: the same tool name + identical `tool_input` run ≥2× in one
 *  interaction. `wastedMs` sums every occurrence after the first. (Separating a
 *  benign re-read from a genuine retry needs a tool-mutation taxonomy — semantic,
 *  not mechanical — so only `redundant_tool` is emitted today; see `gaps`.) */
export function repetitions(
  graph: ExecutionGraph,
  interaction: InteractionExecution,
): Repetition[] {
  const groups = groupByCall(toolNodesInOrder(graph, interaction));
  const out: Repetition[] = [];
  for (const tools of groups.values()) {
    if (tools.length < MIN_OCCURRENCES) continue;
    const [, ...rest] = tools;
    out.push({
      kind: 'redundant_tool',
      signature: `${tools[0]?.name ?? ''}:${hash(tools[0]?.tool_input ?? '')}`,
      occurrences: tools.map((t) => toNodeRef(graph, t.id)),
      wastedMs: rest.reduce((sum, t) => sum + durationMs(t), 0),
    });
  }
  return out;
}
