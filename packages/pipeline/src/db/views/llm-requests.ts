// Why: a columnar table already stores each column separately, so this per-type slice
// buys no storage — it exists only as a typed, documented surface (the inference-specific
// columns, with the per-type NULLs of other types dropped) for the analyst who wants
// `SELECT * FROM llm_requests`. Traversal, edges, and joins still go through `nodes`;
// this is a convenience projection, not a table.

import { pickColumns, type TableSpec } from '../spec.ts';
import { NODES } from '../tables/nodes.ts';

// Why: one list drives both the SELECT and the documented columns so they cannot
// disagree; `pickColumns` reuses the `nodes` column docs verbatim (no drift).
const COLUMNS = [
  'id',
  'parent',
  'session_id',
  'interaction_id',
  'seq',
  'start_time_ns',
  'end_time_ns',
  'duration_ms',
  'model',
  'source',
  'stop_reason',
  'tokens_in',
  'tokens_out',
  'cost_usd',
] as const;

export const LLM_REQUESTS: TableSpec = {
  name: 'llm_requests',
  doc: "VIEW (computed on read, never stored) — one row per llm_request node, projecting the inference columns of `nodes` (WHERE type='llm_request'). A typed convenience surface; the physical table is still `nodes`, where edges and traversal live.",
  view: `SELECT ${COLUMNS.join(', ')} FROM nodes WHERE type = 'llm_request'`,
  columns: pickColumns(NODES.columns, COLUMNS),
};
