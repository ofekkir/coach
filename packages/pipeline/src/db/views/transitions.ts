// Adjacent tool→tool pairs within an interaction. ROW_NUMBER over `seq` ranks the
// tool nodes densely; self-joining rank n to rank n+1 pairs each tool with the next.
// A VIEW (computed on read against `nodes`) so it can never drift from its source.

import type { TableSpec } from '../spec.ts';

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
