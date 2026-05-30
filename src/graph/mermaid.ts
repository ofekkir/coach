import type { TraceNode } from '../etl/types.ts';

// Keep TempoTrace and LogEntry re-exported so existing imports don't break
export type { TempoTrace, LogEntry } from '../etl/types.ts';

function sanitize(text: string): string {
  return text.replace(/`/g, "'").replace(/"/g, "'");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  return `${String(Math.round(ms))}ms`;
}

function buildNodeLabel(node: TraceNode): string {
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

  return lines.join('\n');
}

// ── Composition graph ─────────────────────────────────────────────────────────

export function traceToMermaid(nodes: readonly TraceNode[]): string {
  const nodeLines = nodes.map((n) => {
    const label = sanitize(buildNodeLabel(n));
    return `  ${n.id}["\`${label}\`"]`;
  });

  const edgeLines = nodes
    .filter((n) => n.parent != null)
    .map((n) => `  ${String(n.parent)} --> ${n.id}`);

  return ['graph TD', ...nodeLines, '', ...edgeLines].join('\n');
}

// ── Causal graph ──────────────────────────────────────────────────────────────

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

function causalId(node: TraceNode, childrenOf: Map<string, TraceNode[]>): string {
  return (childrenOf.get(node.id)?.length ?? 0) > 0 ? `sg_${node.id}` : node.id;
}

function formatGap(prev: TraceNode, next: TraceNode): string | null {
  if (prev.end_time_ns == null || next.start_time_ns == null) return null;
  const ms = Number(BigInt(next.start_time_ns) - BigInt(prev.end_time_ns)) / 1_000_000;
  if (!Number.isFinite(ms) || ms === 0) return null;
  return ms > 0 ? `+${formatDuration(ms)}` : `-${formatDuration(-ms)}`;
}

function emitCausalSubtree(
  node: TraceNode,
  childrenOf: Map<string, TraceNode[]>,
  out: string[],
  indent: string,
): void {
  const children = childrenOf.get(node.id);
  const label = sanitize(buildNodeLabel(node));

  if (children == null || children.length === 0) {
    out.push(`${indent}${node.id}["\`${label}\`"]`);
    return;
  }

  const sorted = sortByStart(children);
  // Tool info goes in the subgraph title; children are nodes inside it.
  // External edges reference the subgraph id (sg_<id>).
  out.push(`${indent}subgraph sg_${node.id} ["\`${label}\`"]`);
  for (const child of sorted) {
    emitCausalSubtree(child, childrenOf, out, `${indent}  `);
  }
  // No gap labels inside subgraphs — labels mid-edge overlap the subgraph title text.
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const prev = sorted[i];
    const next = sorted[i + 1];
    if (prev == null || next == null) continue;
    out.push(`${indent}  ${causalId(prev, childrenOf)} --> ${causalId(next, childrenOf)}`);
  }
  out.push(`${indent}end`);
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

export function traceToCausalMermaid(nodes: readonly TraceNode[]): string {
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
  if (interaction == null) return 'graph TD\n  %% no interaction node';

  const directChildren = childrenOf.get(interaction.id) ?? [];

  // Group llm_requests by source into named threads
  const llmsByThread = new Map<string, TraceNode[]>();
  for (const n of directChildren) {
    if (n.type !== 'llm_request') continue;
    const src = n.source ?? 'unknown';
    const list = llmsByThread.get(src) ?? [];
    list.push(n);
    llmsByThread.set(src, list);
  }

  // Build thread member lists: llm_requests + temporally assigned tools and hooks
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

  // Sort each thread's members by start time
  for (const [src, members] of threadMembers) {
    threadMembers.set(src, sortByStart(members));
  }

  // Sort threads by their earliest member's start time
  const sortedSources = [...threadMembers.keys()].sort((a, b) => {
    const aFirst = threadMembers.get(a)?.[0];
    const bFirst = threadMembers.get(b)?.[0];
    return compareStart(aFirst ?? interaction, bFirst ?? interaction);
  });

  const out: string[] = ['graph TD'];

  // Interaction as root node
  const interactionLabel = sanitize(buildNodeLabel(interaction));
  out.push(`  ${interaction.id}["\`${interactionLabel}\`"]`);
  out.push('');

  for (const source of sortedSources) {
    const members = threadMembers.get(source) ?? [];
    const threadId = `thread_${source.replace(/\W+/g, '_')}`;

    out.push(`  subgraph ${threadId} ["\`thread: ${source}\`"]`);
    for (const node of members) {
      emitCausalSubtree(node, childrenOf, out, '    ');
    }
    // Sequential cause→effect edges between thread members
    for (let i = 0; i < members.length - 1; i += 1) {
      const prev = members[i];
      const next = members[i + 1];
      if (prev == null || next == null) continue;
      const gap = formatGap(prev, next);
      const edge = gap != null ? `-->|${gap}|` : '-->';
      out.push(`    ${causalId(prev, childrenOf)} ${edge} ${causalId(next, childrenOf)}`);
    }
    out.push('  end');
    out.push(`  ${interaction.id} --> ${threadId}`);
    out.push('');
  }

  return out.join('\n');
}
