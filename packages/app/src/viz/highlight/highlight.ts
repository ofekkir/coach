import type { ExecutionGraph } from '@coach/pipeline';

import { revealPath } from '../layout/queries.ts';

/** The role a node plays in a handed-over pair: the `source` (e.g. a failed tool
 *  call) and the `dest` (e.g. the call that recovered it). A `plain` node is part
 *  of a generic `?highlight=` list with no source/dest role. */
export type HighlightRole = 'source' | 'dest' | 'plain';

/** A resolved highlight request: which node ids wear which role, and the (deduped)
 *  set of ids the viewport must fit to bring every highlighted node into view. */
export interface Highlight {
  /** Node id → role. Built from `?source`/`?dest` (and optional `?highlight`). */
  roles: ReadonlyMap<string, HighlightRole>;
  /** The ids to pass to `fitView` so the whole highlighted set is visible. */
  fitIds: readonly string[];
}

/** The raw boot params that drive a highlight, all optional and independently
 *  valid: `source`/`dest` alone, both, or a generic comma `highlight` list. */
export interface HighlightParams {
  source?: string | null | undefined;
  dest?: string | null | undefined;
  highlight?: string | null | undefined;
}

function trimmed(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t === '' ? null : t;
}

function splitHighlightList(value: string | null | undefined): string[] {
  return (
    trimmed(value)
      ?.split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '') ?? []
  );
}

/** Parses the boot params into a role map + fit-id list. source/dest win over a
 *  generic `highlight` entry for the same id. Returns null when nothing is
 *  highlighted, so callers can fall back to the single-`focus` path unchanged. */
export function parseHighlight(params: HighlightParams): Highlight | null {
  const source = trimmed(params.source);
  const dest = trimmed(params.dest);
  const roles = new Map<string, HighlightRole>();
  for (const id of splitHighlightList(params.highlight)) roles.set(id, 'plain');
  if (source != null) roles.set(source, 'source');
  if (dest != null) roles.set(dest, 'dest');
  if (roles.size === 0) return null;
  return { roles, fitIds: [...roles.keys()] };
}

/** Every expandable ancestor that must be open for all highlighted ids to render —
 *  the union of each id's `revealPath`. Ids not in the graph contribute nothing
 *  (mirrors how the single-focus path silently no-ops a missing id). */
export function revealForHighlight(graph: ExecutionGraph, highlight: Highlight): Set<string> {
  const reveal = new Set<string>();
  for (const id of highlight.roles.keys()) {
    const path = revealPath(graph, id);
    if (path == null) continue;
    for (const ancestor of path) reveal.add(ancestor);
  }
  return reveal;
}
