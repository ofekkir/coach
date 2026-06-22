import type { CanonicalNode, MessageDeltas, RequestMessage, ResponseMessage } from '../../types.ts';
import { NS_PER_MS } from '../../types.ts';

/** Sentinel "later than any real timestamp" seed for an earliest-start min-search. */
const FAR_FUTURE_NS = 99999999999999999999n;

// Why: ignore `cache_control` when keying — the API moves the ephemeral cache
// breakpoint between requests, so the same logical message serializes differently
// from one turn to the next. Keying on the raw JSON would treat it as new and
// leak it into the next delta.
export function messageKey(msg: RequestMessage): string {
  return JSON.stringify(msg, (key: string, value: unknown) =>
    key === 'cache_control' ? undefined : value,
  );
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

/** The stage-5 message deltas for a node, or undefined when the node is not an
 *  `llm_request` (or carries no messages). Feeds the graph-level `deltas` table
 *  keyed by node id — the delta lives in its own layer, not on the tree node. */
export function llmDeltas(
  node: CanonicalNode,
  seenMessageKeys: ReadonlySet<string>,
): MessageDeltas | undefined {
  if (node.type !== 'llm_request') return undefined;
  const reqDelta = requestMessagesDelta(node.request_messages, seenMessageKeys);
  const resDelta = node.response_messages as readonly ResponseMessage[] | undefined;
  if (reqDelta === undefined && resDelta === undefined) return undefined;
  return {
    ...(reqDelta !== undefined ? { requestMessagesDelta: reqDelta } : {}),
    ...(resDelta !== undefined ? { responseMessagesDelta: resDelta } : {}),
  };
}

// Why: signed gaps are raw millisecond numbers, not formatted strings — the app
// owns presentation ("+12ms"); these helpers do no truncation or labelling.

function nsOf(ns: string | undefined): bigint {
  return ns != null ? BigInt(ns) : 0n;
}

// Why: timing only exists on span-derived members of the union; these accessors
// read it across the whole union without forcing a narrow at every call site.
export function startNs(node: CanonicalNode): string | undefined {
  return 'start_time_ns' in node ? node.start_time_ns : undefined;
}

function endNs(node: CanonicalNode): string | undefined {
  return 'end_time_ns' in node ? node.end_time_ns : undefined;
}

// Why: when two nodes share a start timestamp, a blocked-on-user gate must sort
// before its execution, and both before anything else.
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

function toMs(deltaNs: bigint): number | null {
  const ms = Number(deltaNs) / Number(NS_PER_MS);
  if (!Number.isFinite(ms) || ms === 0) return null;
  return ms;
}

/** Signed gap between two SEQUENTIAL steps (ms): next.start − prev.end. Null when
 *  either timestamp is missing or the gap is zero/non-finite. Raw — no format. */
export function gapMsBetween(prev: CanonicalNode, next: CanonicalNode): number | null {
  const prevEnd = endNs(prev);
  const nextStart = startNs(next);
  if (prevEnd == null || nextStart == null) return null;
  return toMs(BigInt(nextStart) - BigInt(prevEnd));
}

/** Signed gap for a NESTED child (ms): child.start − parent.start. The child runs
 *  within the parent's span, so measuring from the parent's end would be
 *  misleading (it would read negative). Null when a timestamp is missing or zero. */
export function startGapMsBetween(parent: CanonicalNode, child: CanonicalNode): number | null {
  const parentStart = startNs(parent);
  const childStart = startNs(child);
  if (parentStart == null || childStart == null) return null;
  return toMs(BigInt(childStart) - BigInt(parentStart));
}

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
