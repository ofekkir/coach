import type { TraceNode } from '../etl/types.ts';

interface GraphViewEdge {
  fromId: string;
  toId: string;
  label?: string;
}

export interface GraphViewNode {
  id: string;
  labelLines: readonly string[];
  children: readonly GraphViewNode[];
  innerEdges: readonly GraphViewEdge[];
}

interface GraphViewThread {
  id: string;
  title: string;
  members: readonly GraphViewNode[];
  edges: readonly GraphViewEdge[];
}

export interface CausalGraphView {
  root: GraphViewNode;
  threads: readonly GraphViewThread[];
  rootToThreadIds: readonly string[];
}

export interface CompositionGraphView {
  nodes: readonly GraphViewNode[];
  edges: readonly GraphViewEdge[];
}

function nsOf(ns: string | undefined): bigint {
  return ns != null ? BigInt(ns) : 0n;
}

function compareStart(a: TraceNode, b: TraceNode): number {
  const diff = nsOf(a.start_time_ns) - nsOf(b.start_time_ns);
  if (diff !== 0n) return diff < 0n ? -1 : 1;
  // Tiebreak: blocked_on_user always precedes execution semantically
  const priority = (t: string) =>
    t === 'tool.blocked_on_user' ? 0 : t === 'tool.execution' ? 1 : 2;
  return priority(a.type) - priority(b.type);
}

function sortByStart(list: TraceNode[]): TraceNode[] {
  return [...list].sort(compareStart);
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  return `${String(Math.round(ms))}ms`;
}

function formatGap(prev: TraceNode, next: TraceNode): string | null {
  if (prev.end_time_ns == null || next.start_time_ns == null) return null;
  const ms = Number(BigInt(next.start_time_ns) - BigInt(prev.end_time_ns)) / 1_000_000;
  if (!Number.isFinite(ms) || ms === 0) return null;
  return ms > 0 ? `+${formatDuration(ms)}` : `-${formatDuration(-ms)}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function buildLabelLines(node: TraceNode): string[] {
  const lines: string[] = [];

  switch (node.type) {
    case 'interaction':
      lines.push('interaction');
      if (node.prompt != null) lines.push(truncate(node.prompt.replace(/\s+/g, ' '), 80));
      break;
    case 'llm_request':
      lines.push('llm_request');
      if (node.model != null) lines.push(`model: ${node.model}`);
      if (node.source != null) lines.push(`source: ${node.source}`);
      if (node.prompt != null) lines.push(truncate(node.prompt.replace(/\s+/g, ' '), 80));
      if (node.response != null) lines.push(truncate(node.response.replace(/\s+/g, ' '), 80));
      break;
    case 'tool':
      lines.push('tool');
      if (node.name != null) lines.push(`name: ${node.name}`);
      if (node.tool_input != null) lines.push(`input: ${node.tool_input}`);
      break;
    case 'tool.blocked_on_user':
      lines.push('blocked_on_user');
      break;
    case 'tool.execution':
      lines.push('execution');
      break;
    case 'hook':
      lines.push('hook');
      if (node.name != null) lines.push(`name: ${node.name}`);
      break;
    default:
      lines.push(node.type);
  }

  if (node.duration_ms != null) lines.push(`duration: ${formatDuration(node.duration_ms)}`);
  if (node.tokens_in != null) lines.push(`tokens in: ${String(node.tokens_in)}`);
  if (node.tokens_out != null) lines.push(`tokens out: ${String(node.tokens_out)}`);
  if (node.cost_usd != null) lines.push(`cost: $${node.cost_usd.toFixed(6)}`);

  return lines;
}

function resolveId(viewNode: GraphViewNode): string {
  return viewNode.children.length > 0 ? `sg_${viewNode.id}` : viewNode.id;
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
    // No gap labels inside subgraphs — labels mid-edge overlap the subgraph title text.
    innerEdges.push({ fromId: resolveId(prev), toId: resolveId(next) });
  }

  return { id: node.id, labelLines, children: childNodes, innerEdges };
}

// Assigns a non-llm_request node (tool or hook) to a thread.
// UserPromptSubmit always goes to repl_main_thread (it precedes the first LLM
// call and belongs to the main conversation thread by definition).
// All others: pick the thread whose llm_request ended most recently before this
// node started. Falls back to the thread with the earliest-starting llm_request
// for nodes that fire before any llm_request has ended.
function assignNodeToThread(
  node: TraceNode,
  llmsByThread: Map<string, TraceNode[]>,
): string | null {
  if (node.type === 'hook' && node.name === 'UserPromptSubmit') {
    return llmsByThread.has('repl_main_thread') ? 'repl_main_thread' : null;
  }

  const nodeStart = node.start_time_ns != null ? BigInt(node.start_time_ns) : null;

  // Priority 1: node fires while an llm_request span is still open — belongs to
  // that thread (e.g. PreToolUse hooks fire just before the LLM span closes).
  // Among overlapping spans, pick the one that started most recently.
  if (nodeStart != null) {
    let overlappingThread: string | null = null;
    let overlappingStart = -1n;
    for (const [source, reqs] of llmsByThread) {
      for (const req of reqs) {
        if (req.start_time_ns == null || req.end_time_ns == null) continue;
        const s = BigInt(req.start_time_ns);
        const e = BigInt(req.end_time_ns);
        if (s <= nodeStart && nodeStart <= e && s > overlappingStart) {
          overlappingStart = s;
          overlappingThread = source;
        }
      }
    }
    if (overlappingThread != null) return overlappingThread;
  }

  // Priority 2: pick the thread whose llm_request ended most recently before this node.
  let bestByEnd: string | null = null;
  let bestEnd = -1n;
  let firstByStart: string | null = null;
  let firstStart = 99999999999999999999n;

  for (const [source, reqs] of llmsByThread) {
    for (const req of reqs) {
      if (req.start_time_ns != null) {
        const s = BigInt(req.start_time_ns);
        if (s < firstStart) {
          firstStart = s;
          firstByStart = source;
        }
      }
      if (nodeStart != null && req.end_time_ns != null) {
        const e = BigInt(req.end_time_ns);
        if (e <= nodeStart && e > bestEnd) {
          bestEnd = e;
          bestByEnd = source;
        }
      }
    }
  }

  return bestByEnd ?? firstByStart;
}

export function buildCausalGraphView(nodes: readonly TraceNode[]): CausalGraphView | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, TraceNode[]>();

  for (const n of nodes) {
    if (n.parent != null && byId.has(n.parent)) {
      const list = childrenOf.get(n.parent) ?? [];
      list.push(n);
      childrenOf.set(n.parent, list);
    }
  }

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

  const threads: GraphViewThread[] = sortedSources.map((source) => {
    const members = threadMembers.get(source) ?? [];
    const threadId = `thread_${source.replace(/\W+/g, '_')}`;
    const memberViewNodes = members.map((m) => toViewNode(m, childrenOf));

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

export function buildCompositionGraphView(nodes: readonly TraceNode[]): CompositionGraphView {
  const viewNodes: GraphViewNode[] = nodes.map((n) => ({
    id: n.id,
    labelLines: buildLabelLines(n),
    children: [],
    innerEdges: [],
  }));

  const edges: GraphViewEdge[] = nodes
    .filter((n): n is TraceNode & { parent: string } => n.parent != null)
    .map((n) => ({ fromId: n.parent, toId: n.id }));

  return { nodes: viewNodes, edges };
}
