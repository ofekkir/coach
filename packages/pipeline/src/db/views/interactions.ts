// Per-type VIEW: the interaction slice of `nodes`. A typed, documented surface (the
// interaction-specific columns, with other types' NULLs dropped) for the analyst who
// wants `SELECT * FROM interactions`. For richer per-turn rollups (tool_count, cost,
// shape, distinct_files) use `interaction_metrics` instead. The physical table is
// still `nodes`; an interaction's own id IS its interaction_id, so that FK is omitted.

import { pickColumns, type TableSpec } from '../spec.ts';
import { NODES } from '../tables/nodes.ts';

const COLUMNS = [
  'id',
  'session_id',
  'seq',
  'start_time_ns',
  'end_time_ns',
  'duration_ms',
  'sequence',
  'prompt',
  'intent_category',
] as const;

export const INTERACTIONS: TableSpec = {
  name: 'interactions',
  doc: "VIEW (computed on read, never stored) — one row per interaction node, projecting the interaction columns of `nodes` (WHERE type='interaction'). A typed convenience surface; for aggregates over an interaction's nodes use `interaction_metrics`. The physical table is still `nodes`.",
  view: `SELECT ${COLUMNS.join(', ')} FROM nodes WHERE type = 'interaction'`,
  columns: pickColumns(NODES.columns, COLUMNS),
};
