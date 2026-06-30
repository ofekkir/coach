// Per-type VIEW: the tool slice of `nodes`. A typed, documented surface (the
// tool-specific columns, with other types' NULLs dropped) for the analyst who wants
// `SELECT * FROM tools`. The physical table is still `nodes` — edges, containment,
// and traversal go through it; this projection buys clarity, not storage.

import { pickColumns, type TableSpec } from '../spec.ts';
import { NODES } from '../tables/nodes.ts';

const COLUMNS = [
  'id',
  'parent',
  'session_id',
  'interaction_id',
  'seq',
  'start_time_ns',
  'end_time_ns',
  'duration_ms',
  'name',
  'tool_use_id',
  'tool_input',
  'bash_command',
  'is_error',
  'error_kind',
  'output_size',
  'error_message',
] as const;

export const TOOLS: TableSpec = {
  name: 'tools',
  doc: "VIEW (computed on read, never stored) — one row per tool node, projecting the tool columns of `nodes` (WHERE type='tool'). A typed convenience surface; the physical table is still `nodes`, where edges and traversal live. The tool's semantic label + repo_path + coarse action live in `semantics` (one row per tool node, sequence_in_node=0) — join on `id` to read them.",
  view: `SELECT ${COLUMNS.join(', ')} FROM nodes WHERE type = 'tool'`,
  columns: pickColumns(NODES.columns, COLUMNS),
};
