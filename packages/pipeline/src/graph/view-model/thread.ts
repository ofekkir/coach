import type { TraceNode } from '../../etl/types.ts';
import { formatGap, sortByStart } from './format.ts';
import type { GraphViewEdge, GraphViewNode } from './types.ts';

interface ThreadReq {
  source: string;
  req: TraceNode;
}

function flattenThreadReqs(llmsByThread: Map<string, TraceNode[]>): ThreadReq[] {
  return [...llmsByThread.entries()].flatMap(([source, reqs]) =>
    reqs.map((req) => ({ source, req })),
  );
}

function findOverlappingThread(
  llmsByThread: Map<string, TraceNode[]>,
  nodeStart: bigint,
): string | null {
  let overlappingThread: string | null = null;
  let overlappingStart = -1n;
  for (const { source, req } of flattenThreadReqs(llmsByThread)) {
    if (req.start_time_ns == null || req.end_time_ns == null) continue;
    const s = BigInt(req.start_time_ns);
    const e = BigInt(req.end_time_ns);
    if (s <= nodeStart && nodeStart <= e && s > overlappingStart) {
      overlappingStart = s;
      overlappingThread = source;
    }
  }
  return overlappingThread;
}

function findPrecedingThread(
  llmsByThread: Map<string, TraceNode[]>,
  nodeStart: bigint | null,
): string | null {
  let bestByEnd: string | null = null;
  let bestEnd = -1n;
  let firstByStart: string | null = null;
  let firstStart = 99999999999999999999n;

  for (const { source, req } of flattenThreadReqs(llmsByThread)) {
    if (req.start_time_ns != null) {
      const s = BigInt(req.start_time_ns);
      firstStart = s < firstStart ? ((firstByStart = source), s) : firstStart;
    }
    if (nodeStart != null && req.end_time_ns != null) {
      const e = BigInt(req.end_time_ns);
      bestEnd = e <= nodeStart && e > bestEnd ? ((bestByEnd = source), e) : bestEnd;
    }
  }

  return bestByEnd ?? firstByStart;
}

function assignNodeToThread(
  node: TraceNode,
  llmsByThread: Map<string, TraceNode[]>,
): string | null {
  if (node.type === 'hook' && node.name === 'UserPromptSubmit') {
    return llmsByThread.has('repl_main_thread') ? 'repl_main_thread' : null;
  }

  const nodeStart = node.start_time_ns != null ? BigInt(node.start_time_ns) : null;

  if (nodeStart != null) {
    const overlapping = findOverlappingThread(llmsByThread, nodeStart);
    if (overlapping != null) return overlapping;
  }

  return findPrecedingThread(llmsByThread, nodeStart);
}

export function buildChildrenOf(nodes: readonly TraceNode[]): Map<string, TraceNode[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, TraceNode[]>();
  for (const n of nodes) {
    if (n.parent != null && byId.has(n.parent)) {
      const list = childrenOf.get(n.parent) ?? [];
      list.push(n);
      childrenOf.set(n.parent, list);
    }
  }
  return childrenOf;
}

export function buildThreadMembers(
  directChildren: TraceNode[],
  llmsByThread: Map<string, TraceNode[]>,
): Map<string, TraceNode[]> {
  const threadMembers = new Map<string, TraceNode[]>();
  for (const [src, reqs] of llmsByThread) {
    threadMembers.set(src, [...reqs]);
  }
  for (const n of directChildren) {
    if (n.type !== 'tool' && n.type !== 'hook') continue;
    const thread = assignNodeToThread(n, llmsByThread);
    if (thread != null) {
      threadMembers.get(thread)?.push(n);
    }
  }
  for (const [src, members] of threadMembers) {
    threadMembers.set(src, sortByStart(members));
  }
  return threadMembers;
}

function resolveId(viewNode: GraphViewNode): string {
  return viewNode.children.length > 0 ? `sg_${viewNode.id}` : viewNode.id;
}

export function buildThreadEdges(
  members: TraceNode[],
  memberViewNodes: GraphViewNode[],
): GraphViewEdge[] {
  const edges: GraphViewEdge[] = [];
  for (let i = 0; i < memberViewNodes.length - 1; i += 1) {
    const prevNode = members[i];
    const nextNode = members[i + 1];
    if (prevNode == null || nextNode == null) continue;
    const prevView = memberViewNodes[i];
    const nextView = memberViewNodes[i + 1];
    if (prevView == null || nextView == null) continue;
    const gap = formatGap(prevNode, nextNode);
    edges.push({
      fromId: resolveId(prevView),
      toId: resolveId(nextView),
      ...(gap !== null ? { label: gap } : {}),
    });
  }
  return edges;
}
