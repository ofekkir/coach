import type { NodeType, TraceNode } from '../../etl/types.ts';
import { buildLabelLines, compareStart, sortByStart } from './format.ts';
import { buildChildrenOf, buildThreadEdges, buildThreadMembers } from './thread.ts';
import type { CausalGraphView, GraphViewEdge, GraphViewNode, StepView } from './types.ts';

function resolveId(viewNode: GraphViewNode): string {
  return viewNode.children.length > 0 ? `sg_${viewNode.id}` : viewNode.id;
}

function stepKind(nodeType: NodeType): 'inference' | 'action' {
  return nodeType === 'llm_request' ? 'inference' : 'action';
}

function toStepView(node: TraceNode, childrenOf: Map<string, TraceNode[]>): StepView {
  return { ...toViewNode(node, childrenOf), kind: stepKind(node.type) };
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

  const threads = sortedSources.map((source) => {
    const members = threadMembers.get(source) ?? [];
    const threadId = `thread_${source.replace(/\W+/g, '_')}`;
    const memberViewNodes = members.map((m) => toStepView(m, childrenOf));
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
  };
}
