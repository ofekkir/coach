import type { CanonicalNode, RequestMessage, ResponseMessage } from '../../types.ts';
import { NS_PER_MS } from '../../types.ts';
import type { ExecutionNode } from '../types.ts';

/** Sentinel "later than any real timestamp" seed for an earliest-start min-search. */
const FAR_FUTURE_NS = 99999999999999999999n;

// ── Message delta helpers ───────────────────────────────────────────────────

function messageKey(msg: RequestMessage): string {
  return JSON.stringify(msg);
}

/** Messages in `current` not already present in `seenKeys`. Works for both
 *  cumulative (OTEL) and already-delta (native) formats. */
function requestMessagesDelta(
  current: readonly RequestMessage[] | undefined,
  seenKeys: ReadonlySet<string>,
): readonly RequestMessage[] | undefined {
  if (current == null) return undefined;
  return current.filter((msg) => !seenKeys.has(messageKey(msg)));
}

/** Annotates a base ExecutionNode with llm_request delta fields when the node
 *  is an llm_request. Non-llm_request nodes are returned unchanged. */
export function withLlmDeltas(
  base: ExecutionNode,
  node: CanonicalNode,
  seenMessageKeys: ReadonlySet<string>,
): ExecutionNode {
  if (node.type !== 'llm_request') return base;
  const reqDelta = requestMessagesDelta(node.request_messages, seenMessageKeys);
  const resDelta = node.response_messages as readonly ResponseMessage[] | undefined;
  return {
    ...base,
    ...(reqDelta !== undefined ? { requestMessagesDelta: reqDelta } : {}),
    ...(resDelta !== undefined ? { responseMessagesDelta: resDelta } : {}),
  };
}

// ── Pure ordering / timing helpers (ported from view-model/format.ts) ──────────
//
// These are mechanical, presentation-free. The signed gap is a raw number of
// milliseconds (gapMs) — the app formats it ("+12ms"). No truncation, no labels.

function nsOf(ns: string | undefined): bigint {
  return ns != null ? BigInt(ns) : 0n;
}

// Timing lives on span-derived nodes (and optionally on the synthesized
// user_prompt); aggregation nodes (agent/session) have none. These accessors
// read it across the whole union without forcing a narrow at every call site.
export function startNs(node: CanonicalNode): string | undefined {
  return 'start_time_ns' in node ? node.start_time_ns : undefined;
}

function endNs(node: CanonicalNode): string | undefined {
  return 'end_time_ns' in node ? node.end_time_ns : undefined;
}

// Tie-break order when two nodes share a start timestamp: a blocked-on-user gate
// sorts before its execution, both before anything else.
const SORT_RANK_BY_TYPE = new Map<string, number>([
  ['tool.blocked_on_user', 0],
  ['tool.execution', 1],
]);
const DEFAULT_SORT_RANK = 2;

export function compareStart(a: CanonicalNode, b: CanonicalNode): number {
  const diff = nsOf(startNs(a)) - nsOf(startNs(b));
  if (diff !== 0n) return diff < 0n ? -1 : 1;
  const rank = (t: string) => SORT_RANK_BY_TYPE.get(t) ?? DEFAULT_SORT_RANK;
  return rank(a.type) - rank(b.type);
}

export function sortByStart<T extends CanonicalNode>(list: T[]): T[] {
  return [...list].sort(compareStart);
}

/** Signed gap between two adjacent steps in milliseconds, or null when either
 *  timestamp is missing or the gap is zero/non-finite. Raw number — no format. */
export function gapMsBetween(prev: CanonicalNode, next: CanonicalNode): number | null {
  const prevEnd = endNs(prev);
  const nextStart = startNs(next);
  if (prevEnd == null || nextStart == null) return null;
  const ms = Number(BigInt(nextStart) - BigInt(prevEnd)) / Number(NS_PER_MS);
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
    const reqStart = startNs(req);
    const reqEnd = endNs(req);
    if (reqStart == null || reqEnd == null) continue;
    const s = BigInt(reqStart);
    const e = BigInt(reqEnd);
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
  let firstStart = FAR_FUTURE_NS;

  for (const { source, req } of flattenThreadReqs(llmsByThread)) {
    const reqStart = startNs(req);
    const reqEnd = endNs(req);
    if (reqStart != null) {
      const s = BigInt(reqStart);
      firstStart = s < firstStart ? ((firstByStart = source), s) : firstStart;
    }
    if (nodeStart != null && reqEnd != null) {
      const e = BigInt(reqEnd);
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

  const nodeStartNs = startNs(node);
  const nodeStart = nodeStartNs != null ? BigInt(nodeStartNs) : null;

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
