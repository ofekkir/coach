// Why: kept as a VIEW (computed on read against `nodes`) rather than a stored table
// so it can never drift from its source — on a columnar engine a stored copy would
// buy no query power.

import type { TableSpec } from '../spec.ts';

const INTERACTION_METRICS_VIEW = `
SELECT
  i.id AS interaction_id,
  i.session_id,
  i.sequence,
  length(i.prompt) AS prompt_len,
  COUNT(*) FILTER (WHERE n.type = 'tool') AS tool_count,
  COUNT(*) FILTER (WHERE n.type = 'llm_request') AS llm_count,
  SUM(n.tokens_in) FILTER (WHERE n.type = 'llm_request') AS tokens_in,
  SUM(n.tokens_out) FILTER (WHERE n.type = 'llm_request') AS tokens_out,
  SUM(n.cost_usd) FILTER (WHERE n.type = 'llm_request') AS cost_usd,
  i.duration_ms,
  CASE WHEN COUNT(*) FILTER (WHERE n.type = 'tool') > 0 THEN 'agentic' ELSE 'direct' END AS shape,
  arg_min(n.action, n.seq) FILTER (WHERE n.type = 'tool') AS first_action,
  arg_max(n.action, n.seq) FILTER (WHERE n.type = 'tool') AS last_action,
  COUNT(DISTINCT n.file_path) FILTER (WHERE n.type = 'tool') AS distinct_files,
  COUNT(*) FILTER (WHERE n.type = 'tool' AND n.is_error) AS error_count
FROM nodes i
JOIN nodes n ON n.interaction_id = i.id
WHERE i.type = 'interaction'
GROUP BY i.id, i.session_id, i.sequence, i.prompt, i.duration_ms`;

export const INTERACTION_METRICS: TableSpec = {
  name: 'interaction_metrics',
  doc: "VIEW (computed on read, never stored) — one row per interaction node. Every column is the direct aggregate over that interaction's `nodes` rows, so it can never drift from `nodes`; it exists to make the common per-turn aggregates a flat lookup. `shape='agentic'` iff tool_count>0.",
  view: INTERACTION_METRICS_VIEW,
  columns: [
    // prettier-ignore
    { name: 'interaction_id', sqlType: 'VARCHAR', doc: "FK → the interaction node id (nodes.id where type='interaction'). One row per interaction." },
    {
      name: 'session_id',
      sqlType: 'VARCHAR',
      doc: "FK → sessions.id (the interaction node's session).",
    },
    // prettier-ignore
    { name: 'sequence', sqlType: 'INTEGER', doc: "The interaction's 0-based turn index within the session (nodes.sequence)." },
    {
      name: 'prompt_len',
      sqlType: 'INTEGER',
      doc: 'Character length of the interaction prompt (nodes.prompt).',
    },
    {
      name: 'tool_count',
      sqlType: 'INTEGER',
      doc: "Count of tool nodes (type='tool') in the interaction.",
    },
    {
      name: 'llm_count',
      sqlType: 'INTEGER',
      doc: 'Count of llm_request nodes in the interaction.',
    },
    {
      name: 'tokens_in',
      sqlType: 'DOUBLE',
      doc: "SUM of tokens_in over the interaction's llm_request nodes.",
    },
    {
      name: 'tokens_out',
      sqlType: 'DOUBLE',
      doc: "SUM of tokens_out over the interaction's llm_request nodes.",
    },
    // prettier-ignore
    { name: 'cost_usd', sqlType: 'DOUBLE', doc: "SUM of the traced cost_usd over the interaction's llm_request nodes; NULL when no node carries a traced cost (cost is never estimated)." },
    {
      name: 'duration_ms',
      sqlType: 'DOUBLE',
      doc: "The interaction node's own wall-clock duration in ms.",
    },
    // prettier-ignore
    { name: 'shape', sqlType: 'VARCHAR', doc: "'agentic' iff tool_count>0 (the interaction called at least one tool), else 'direct'." },
    // prettier-ignore
    { name: 'first_action', sqlType: 'VARCHAR', doc: 'The `action` of the first tool node by seq. NULL when the interaction has no tool nodes.' },
    // prettier-ignore
    { name: 'last_action', sqlType: 'VARCHAR', doc: 'The `action` of the last tool node by seq. NULL when the interaction has no tool nodes.' },
    // prettier-ignore
    { name: 'distinct_files', sqlType: 'INTEGER', doc: "Count of distinct non-NULL file_path among the interaction's tool nodes." },
    {
      name: 'error_count',
      sqlType: 'INTEGER',
      doc: 'Count of tool nodes with is_error=true in the interaction.',
    },
  ],
};
