import type { CanonicalNode } from '../../types.ts';

// ── Pure ordering / timing helpers (ported from view-model/format.ts) ──────────
//
// These are mechanical, presentation-free. The signed gap is a raw number of
// milliseconds (gapMs) — the app formats it ("+12ms"). No truncation, no labels.

function nsOf(ns: string | undefined): bigint {
  return ns != null ? BigInt(ns) : 0n;
}

export function compareStart(a: CanonicalNode, b: CanonicalNode): number {
  const diff = nsOf(a.start_time_ns) - nsOf(b.start_time_ns);
  if (diff !== 0n) return diff < 0n ? -1 : 1;
  const priority = (t: string) =>
    t === 'tool.blocked_on_user' ? 0 : t === 'tool.execution' ? 1 : 2;
  return priority(a.type) - priority(b.type);
}

export function sortByStart(list: CanonicalNode[]): CanonicalNode[] {
  return [...list].sort(compareStart);
}

/** Signed gap between two adjacent steps in milliseconds, or null when either
 *  timestamp is missing or the gap is zero/non-finite. Raw number — no format. */
export function gapMsBetween(prev: CanonicalNode, next: CanonicalNode): number | null {
  if (prev.end_time_ns == null || next.start_time_ns == null) return null;
  const ms = Number(BigInt(next.start_time_ns) - BigInt(prev.end_time_ns)) / 1_000_000;
  if (!Number.isFinite(ms) || ms === 0) return null;
  return ms;
}

// ── Parent → children index ────────────────────────────────────────────────────

export function buildChildrenOf(nodes: readonly CanonicalNode[]): Map<string, CanonicalNode[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, CanonicalNode[]>();
  for (const n of nodes) {
    if (n.parent == null || !byId.has(n.parent)) continue;
    const list = childrenOf.get(n.parent) ?? [];
    list.push(n);
    childrenOf.set(n.parent, list);
  }
  return childrenOf;
}

// ── Thread assignment (ported verbatim from view-model/thread.ts) ──────────────

interface ThreadReq {
  source: string;
  req: CanonicalNode;
}

function flattenThreadReqs(llmsByThread: Map<string, CanonicalNode[]>): ThreadReq[] {
  return [...llmsByThread.entries()].flatMap(([source, reqs]) =>
    reqs.map((req) => ({ source, req })),
  );
}

function findOverlappingThread(
  llmsByThread: Map<string, CanonicalNode[]>,
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
  llmsByThread: Map<string, CanonicalNode[]>,
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
  node: CanonicalNode,
  llmsByThread: Map<string, CanonicalNode[]>,
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

export function buildThreadMembers(
  directChildren: CanonicalNode[],
  llmsByThread: Map<string, CanonicalNode[]>,
): Map<string, CanonicalNode[]> {
  const threadMembers = new Map<string, CanonicalNode[]>();
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
