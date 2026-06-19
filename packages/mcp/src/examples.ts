// Worked queries surfaced by `describe_schema`. The stage-7 detectors are
// included verbatim as SQL so the agent learns the patterns and can extend them,
// rather than treating the curated analysis as a closed black box.

export interface ExampleQuery {
  readonly title: string;
  readonly sql: string;
}

export const EXAMPLE_QUERIES: readonly ExampleQuery[] = [
  {
    title: 'Cost / token / latency rollup per session (the stage-7 Rollup)',
    sql: `SELECT session_id,
       SUM(cost_usd)                          AS cost_usd,
       SUM(tokens_in)                         AS tokens_in,
       SUM(tokens_out)                        AS tokens_out,
       COUNT(*) FILTER (WHERE type='llm_request') AS llm_calls,
       COUNT(*) FILTER (WHERE type='tool')        AS tool_calls
FROM nodes
GROUP BY session_id
ORDER BY cost_usd DESC`,
  },
  {
    title: 'Interaction shape: query (no tools) vs agentic (≥1 tool)',
    sql: `SELECT interaction_id,
       CASE WHEN COUNT(*) FILTER (WHERE type='tool') > 0 THEN 'agentic' ELSE 'query' END AS shape
FROM nodes
GROUP BY interaction_id`,
  },
  {
    title:
      'Redundant tool calls: identical (name, tool_input) ≥2× in one interaction (the stage-7 Repetition)',
    sql: `SELECT interaction_id, name, tool_input,
       COUNT(*)                       AS occurrences,
       SUM(duration_ms)
         - MAX(duration_ms)           AS approx_wasted_ms,
       list(id)                       AS occurrence_ids
FROM nodes
WHERE type='tool'
GROUP BY interaction_id, name, tool_input
HAVING COUNT(*) >= 2
ORDER BY occurrences DESC`,
  },
  {
    title: 'Longest single step in each interaction (the stage-7 Hotspot)',
    sql: `SELECT interaction_id, id, type, name, duration_ms
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY interaction_id ORDER BY duration_ms DESC) AS rk
  FROM nodes
  WHERE duration_ms IS NOT NULL
)
WHERE rk = 1
ORDER BY duration_ms DESC`,
  },
  {
    title: 'Reach into un-promoted fields via the JSON escape hatch',
    sql: `SELECT id, json_extract_string(data, '$.stop_reason') AS stop_reason
FROM nodes
WHERE type='llm_request'`,
  },
  {
    title: 'Tools joined to the inference that emitted them (via tool_use_id → causal_edges)',
    sql: `SELECT c.from_id AS inference_id, t.id AS tool_id, t.name, t.duration_ms
FROM nodes t
JOIN causal_edges c ON c.to_id = t.id
WHERE t.type = 'tool'`,
  },
];
