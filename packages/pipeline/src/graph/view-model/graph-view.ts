import type { TraceNode } from '../../etl/types.ts';
import { buildLabelLines, compareStart, sortByStart } from './format.ts';
import { buildChildrenOf, buildThreadEdges, buildThreadMembers } from './thread.ts';
import type {
  CausalGraphView,
  GraphViewEdge,
  GraphViewNode,
  InteractionShape,
  SegmentView,
  StepView,
} from './types.ts';
import { actionVerbFromNode, inferenceMovesFromRawResponse } from './verbs.ts';

function resolveId(viewNode: GraphViewNode): string {
  return viewNode.children.length > 0 ? `sg_${viewNode.id}` : viewNode.id;
}

// V1: all steps belong to a single segment (index 0).
// Seam: replace with a boundary-detection pass over members' moves/verbs to
// detect goal shifts (e.g. thinking-topic change, end_turn followed by new
// reasoning), or delegate to an LLM classifier.
function assignSegments(members: TraceNode[]): number[] {
  return members.map(() => 0);
}

function deriveInteractionShape(directChildren: TraceNode[]): InteractionShape {
  const llms = directChildren.filter((n) => n.type === 'llm_request');
  const tools = directChildren.filter((n) => n.type === 'tool');
  if (llms.length === 1 && tools.length === 0 && llms[0]?.stop_reason === 'end_turn') {
    return 'query';
  }
  return 'agentic';
}

function toStepView(
  node: TraceNode,
  childrenOf: Map<string, TraceNode[]>,
  segmentIndex: number,
): StepView {
  const base = toViewNode(node, childrenOf);
  if (node.type === 'llm_request') {
    return {
      ...base,
      kind: 'inference',
      moves: inferenceMovesFromRawResponse(node.raw_response),
      segmentIndex,
    };
  }
  return {
    ...base,
    kind: 'action',
    verb: actionVerbFromNode(node.name, node.tool_input),
    segmentIndex,
  };
}

function toViewNode(node: TraceNode, childrenOf: Map<string, TraceNode[]>): GraphViewNode {
  const rawChildren = childrenOf.get(node.id);
  const labelLines = buildLabelLines(node);

  if (rawChildren == null || rawChildren.length === 0) {
    return { id: node.id, labelLines, children: [], innerEdges: [] };
  }

  const sorted = sortByStart(rawChildren);
  const childNodes = sorted.map((child) => toViewNode(child, childrenOf));

  const innerEdges: GraphViewEdge[] = [];
  for (let i = 0; i < childNodes.length - 1; i += 1) {
    const prev = childNodes[i];
    const next = childNodes[i + 1];
    if (prev == null || next == null) continue;
    innerEdges.push({ fromId: resolveId(prev), toId: resolveId(next) });
  }

  return { id: node.id, labelLines, children: childNodes, innerEdges };
}

function buildSegmentViews(segmentIndices: number[]): SegmentView[] {
  const unique = [...new Set(segmentIndices)].sort((a, b) => a - b);
  return unique.map((index) => ({ index, label: `segment ${String(index + 1)}` }));
}

export function buildCausalGraphView(nodes: readonly TraceNode[]): CausalGraphView | null {
  const childrenOf = buildChildrenOf(nodes);

  const interaction = nodes.find((n) => n.type === 'interaction');
  if (interaction == null) return null;

  const directChildren = childrenOf.get(interaction.id) ?? [];

  const llmsByThread = new Map<string, TraceNode[]>();
  for (const n of directChildren) {
    if (n.type !== 'llm_request') continue;
    const src = n.source ?? 'unknown';
    const list = llmsByThread.get(src) ?? [];
    list.push(n);
    llmsByThread.set(src, list);
  }

  const threadMembers = buildThreadMembers(directChildren, llmsByThread);

  const sortedSources = [...threadMembers.keys()].sort((a, b) => {
    const aFirst = threadMembers.get(a)?.[0];
    const bFirst = threadMembers.get(b)?.[0];
    return compareStart(aFirst ?? interaction, bFirst ?? interaction);
  });

  const root: GraphViewNode = {
    id: interaction.id,
    labelLines: buildLabelLines(interaction),
    children: [],
    innerEdges: [],
  };

  const shape = deriveInteractionShape(directChildren);

  const allSegmentIndices: number[] = [];
  const threads = sortedSources.map((source) => {
    const members = threadMembers.get(source) ?? [];
    const threadId = `thread_${source.replace(/\W+/g, '_')}`;
    const segIndices = assignSegments(members);
    allSegmentIndices.push(...segIndices);
    const memberViewNodes = members.map((m, i) => toStepView(m, childrenOf, segIndices[i] ?? 0));
    const edges = buildThreadEdges(members, memberViewNodes);

    return {
      id: threadId,
      title: `thread: ${source}`,
      members: memberViewNodes,
      edges,
    };
  });

  return {
    root,
    threads,
    rootToThreadIds: threads.map((t) => t.id),
    segments: buildSegmentViews(allSegmentIndices),
    shape,
  };
}
