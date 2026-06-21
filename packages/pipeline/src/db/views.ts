// The two DERIVED relations, expressed as DuckDB VIEWs rather than materialized
// tables. Both are pure aggregates over `nodes`, so in a columnar engine a stored
// copy buys no query power and only risks drifting from its source. As views they
// are computed on read — they can NEVER disagree with `nodes` — yet still expose a
// flat, documented surface the analyst agent can `SELECT *` from. `describe_schema`
// renders these specs exactly like a table; the `view` body is the only difference.

import type { TableSpec } from './schema.ts';

// One row per interaction node, every column a plain GROUP BY aggregate over that
// interaction's nodes. arg_min/arg_max over `seq` give the first/last tool action;
// FILTER (...) yields NULL when the interaction has no tool nodes.
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

// Adjacent tool→tool pairs within an interaction. ROW_NUMBER over `seq` ranks the
// tool nodes densely; self-joining rank n to rank n+1 pairs each tool with the next.
const TRANSITIONS_VIEW = `
WITH tool_seq AS (
  SELECT interaction_id, seq, action,
         ROW_NUMBER() OVER (PARTITION BY interaction_id ORDER BY seq) AS rn
  FROM nodes
  WHERE type = 'tool'
)
SELECT a.interaction_id, a.seq AS from_seq, a.action AS from_action, b.action AS to_action
FROM tool_seq a
JOIN tool_seq b ON b.interaction_id = a.interaction_id AND b.rn = a.rn + 1`;

export const TRANSITIONS: TableSpec = {
  name: 'transitions',
  doc: "VIEW (computed on read, never stored) — adjacent tool→tool action pairs within an interaction, ordered by `seq`. One row per adjacent tool pair → exactly tool_count−1 rows per interaction (0 when ≤1 tool). ADJACENCY, NOT causality: a row means 'this tool ran immediately after that one', NOT that it was triggered by it (causality lives in causal_edges). GROUP BY (from_action, to_action) for the action-flow histogram (e.g. explore→edit, edit→verify).",
  view: TRANSITIONS_VIEW,
  columns: [
    { name: 'interaction_id', sqlType: 'VARCHAR', doc: 'FK → owning interaction node id.' },
    // prettier-ignore
    { name: 'from_seq', sqlType: 'INTEGER', doc: 'nodes.seq of the source (earlier) tool node — join back to nodes on (interaction_id, seq).' },
    // prettier-ignore
    { name: 'from_action', sqlType: 'VARCHAR', doc: "Closed `action` bucket of the source tool ('explore'|'author'|'edit'|'run'|'test'|'verify'|'vcs'|'setup'|'mcp'|'research'|'delegate'|'plan'|'other')." },
    // prettier-ignore
    { name: 'to_action', sqlType: 'VARCHAR', doc: 'Closed `action` bucket of the next tool (same closed enum as from_action).' },
  ],
};
