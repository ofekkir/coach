// The relational schema the store exposes to an analyst agent. This is the SINGLE
// SOURCE OF TRUTH: a backend builds the DuckDB tables from `TABLES` (via
// `materialize.ts`), and the MCP's `describe_schema` tool renders the very same
// specs — so the DDL the data lives in and the schema the agent reads can never
// drift. The execution graph (stage 6) is already a normalized, id-keyed
// relational model (see ARCHITECTURE.md); these tables are that model queryable:
//   nodes / deltas / semantics  — the three id-keyed node-data layers
//   containment / causal_edges  — the two edge relations over those nodes
//   threads                     — layout lanes (grouping, not causality)
//   agents / sessions           — the dimension entities (FK targets, not nodes)
export interface ColumnSpec {
  readonly name: string;
  /** DuckDB column type. `JSON` columns are populated from a JS value via CAST. */
  readonly sqlType: 'VARCHAR' | 'DOUBLE' | 'INTEGER' | 'BIGINT' | 'BOOLEAN' | 'JSON';
  readonly doc: string;
}

export interface TableSpec {
  readonly name: string;
  readonly doc: string;
  readonly columns: readonly ColumnSpec[];
}

const NODES: TableSpec = {
  name: 'nodes',
  doc: 'One row per CanonicalNode — the unified, harness-agnostic node table. Common columns are promoted; type-specific columns are populated only for the relevant `type` and NULL otherwise; `data` carries the full raw node for anything not promoted.',
  columns: [
    {
      name: 'id',
      sqlType: 'VARCHAR',
      doc: 'Node id. The one id namespace joined across every layer.',
    },
    {
      name: 'type',
      sqlType: 'VARCHAR',
      doc: "Discriminant: 'interaction' | 'llm_request' | 'tool' | 'tool.execution' | 'tool.blocked_on_user' | 'hook'.",
    },
    {
      name: 'parent',
      sqlType: 'VARCHAR',
      doc: 'Containment parent node id (self-FK → nodes.id); also exposed as the `containment` table.',
    },
    {
      name: 'session_id',
      sqlType: 'VARCHAR',
      doc: 'FK → sessions.id. Denormalized onto every node so per-session aggregation is a flat filter.',
    },
    { name: 'interaction_id', sqlType: 'VARCHAR', doc: 'FK → owning interaction node id.' },
    {
      name: 'start_time_ns',
      sqlType: 'VARCHAR',
      doc: 'Span start, ns. VARCHAR because the value overflows DOUBLE precision.',
    },
    { name: 'end_time_ns', sqlType: 'VARCHAR', doc: 'Span end, nanoseconds (VARCHAR).' },
    // prettier-ignore
    { name: 'start_time', sqlType: 'BIGINT', doc: 'Span start, ns — numeric form of start_time_ns (BIGINT holds the full int64). ORDER BY start_time == ORDER BY seq within an interaction.' },
    // prettier-ignore
    { name: 'end_time', sqlType: 'BIGINT', doc: 'Span end, ns — numeric form of end_time_ns (BIGINT).' },
    // prettier-ignore
    { name: 'seq', sqlType: 'INTEGER', doc: 'Dense 0..n-1 rank of this node within its owning interaction (every node sharing interaction_id), by start_time_ns ascending. ORDER BY seq == ORDER BY start_time_ns — a stable per-interaction timeline index.' },
    { name: 'duration_ms', sqlType: 'DOUBLE', doc: 'Span wall-clock in ms.' },
    { name: 'model', sqlType: 'VARCHAR', doc: 'llm_request: model id.' },
    { name: 'source', sqlType: 'VARCHAR', doc: 'llm_request: emitting loop/source.' },
    { name: 'stop_reason', sqlType: 'VARCHAR', doc: 'llm_request: stop reason, when present.' },
    { name: 'tokens_in', sqlType: 'DOUBLE', doc: 'llm_request: input tokens.' },
    { name: 'tokens_out', sqlType: 'DOUBLE', doc: 'llm_request: output tokens.' },
    { name: 'cost_usd', sqlType: 'DOUBLE', doc: 'llm_request: cost in USD, when present.' },
    { name: 'name', sqlType: 'VARCHAR', doc: 'tool/hook: the tool or hook name.' },
    {
      name: 'tool_use_id',
      sqlType: 'VARCHAR',
      doc: 'tool: harness tool-call id — the join key to the llm_request that emitted (tool_use) and consumed (tool_result) it.',
    },
    {
      name: 'tool_input',
      sqlType: 'VARCHAR',
      doc: 'tool: serialized tool input. Identical (name, tool_input) ≥2× in one interaction is the redundant-tool signal.',
    },
    {
      name: 'action',
      sqlType: 'VARCHAR',
      doc: "tool: closed activity bucket, NON-NULL for every tool node — 'explore'|'author'|'edit'|'run'|'test'|'verify'|'vcs'|'setup'|'mcp'|'research'|'delegate'|'plan'|'other'. Deterministically derived from (name, bash command); GROUP BY it for stable counts. Coarse dimension, distinct from the free-form semantics.what.",
    },
    // prettier-ignore
    { name: 'is_error', sqlType: 'BOOLEAN', doc: "tool: did the matched tool_result carry is_error=true? Matched by tool_use_id from the consuming inference's request messages. NULL when no result was matched (the call is reported, never dropped)." },
    // prettier-ignore
    { name: 'error_kind', sqlType: 'VARCHAR', doc: "tool: deterministic error class (no LLM) — 'not_found' | 'invalid_args' | 'permission' | 'timeout' | 'nonzero_exit' | 'other'. NULL when the call succeeded or had no matched result. Count Edit/Write rows WHERE is_error for the misleading-file (failed-edits-per-file) signal." },
    // prettier-ignore
    { name: 'result_summary', sqlType: 'VARCHAR', doc: 'tool: ≤500-char summary of the tool_result/error text (cleanly truncated). NULL when the result had no text.' },
    {
      name: 'sequence',
      sqlType: 'INTEGER',
      doc: 'interaction: 0-based turn index within the session.',
    },
    {
      name: 'prompt',
      sqlType: 'VARCHAR',
      doc: 'interaction: the user prompt text (the spine head; not a separate node).',
    },
    // prettier-ignore
    { name: 'repo_path', sqlType: 'VARCHAR', doc: "tool: repo-relative file path derived from tool_input (Read/Edit/Write/etc). Worktree-normalized — a path under …/.claude/worktrees/<id>/<rest> collapses to <rest>, so the same file under two worktrees yields ONE repo_path. Never contains '/.claude/worktrees/' and never has a leading '/'. NULL when the tool input carries no file path." },
    {
      name: 'data',
      sqlType: 'JSON',
      doc: "The full raw CanonicalNode. Escape hatch for un-promoted fields, e.g. request_messages / response_messages. Reach in with json_extract / data->>'$.field'.",
    },
  ],
};

const DELTAS: TableSpec = {
  name: 'deltas',
  doc: 'Stage-5 message deltas. Sparse — only llm_request nodes get a row. The messages new to this request relative to the previous request in its thread.',
  columns: [
    { name: 'id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (an llm_request).' },
    {
      name: 'request_messages_delta',
      sqlType: 'JSON',
      doc: 'Request messages beyond the previous request (the first carries its full array).',
    },
    {
      name: 'response_messages_delta',
      sqlType: 'JSON',
      doc: 'The full response (each response is all-new).',
    },
  ],
};

const SEMANTICS: TableSpec = {
  name: 'semantics',
  doc: "Stage-6 semantic labels. Sparse — only relabeled (tool / llm_request) nodes get a row; the presence of a row IS the 'is this enriched?' flag. `what` values come from the closed ontology vocabulary (see describe_schema → vocabulary).",
  columns: [
    { name: 'id', sqlType: 'VARCHAR', doc: 'FK → nodes.id.' },
    {
      name: 'what',
      sqlType: 'JSON',
      doc: 'Ordered list of atomic action phrases, e.g. ["fetch ynet.co.il","summarize headlines"].',
    },
    {
      name: 'comment',
      sqlType: 'VARCHAR',
      doc: 'Optional agent-authored annotation harvested verbatim (e.g. a Bash `description`). Display signal only.',
    },
  ],
};

const CONTAINMENT: TableSpec = {
  name: 'containment',
  doc: 'The containment relation ("parent contains child in time"), derived from the node `parent` self-FK. Exactly one parent per child. Walk it with the `subtree` tool or a recursive CTE.',
  columns: [
    { name: 'parent_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (the container).' },
    { name: 'child_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (contained).' },
  ],
};

const CAUSAL_EDGES: TableSpec = {
  name: 'causal_edges',
  doc: 'The causal DAG ("cause triggers effect") — the only edge layer with causal meaning (time-adjacency is NOT causality). Inference→tool fan-out, tool→inference fan-in (by tool_use_id), inference→inference continuation, prompt→turn. Walk it with the `causal_path` tool.',
  columns: [
    { name: 'from_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (the cause).' },
    { name: 'to_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (the effect).' },
    {
      name: 'gap_ms',
      sqlType: 'DOUBLE',
      doc: 'Signed gap cause-end → effect-start (often negative for fan-out dispatched mid-stream).',
    },
  ],
};

const THREADS: TableSpec = {
  name: 'threads',
  doc: 'Layout lanes — a grouping of an interaction\'s steps into an execution lane (e.g. "repl_main_thread"). Membership only; adjacency here is NOT causality.',
  columns: [
    { name: 'thread_id', sqlType: 'VARCHAR', doc: 'Thread id.' },
    { name: 'interaction_id', sqlType: 'VARCHAR', doc: 'FK → owning interaction node id.' },
    { name: 'source', sqlType: 'VARCHAR', doc: "The loop that emitted the lane's inferences." },
    { name: 'node_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (a top-level member of the lane).' },
    {
      name: 'position',
      sqlType: 'INTEGER',
      doc: '0-based order of the member within the lane (time order).',
    },
  ],
};

const AGENTS: TableSpec = {
  name: 'agents',
  doc: 'The agent dimension entity — a FK target, never a node. Single-agent today.',
  columns: [
    { name: 'id', sqlType: 'VARCHAR', doc: 'Agent id.' },
    { name: 'user_id', sqlType: 'VARCHAR', doc: 'The user behind the agent.' },
  ],
};

const SESSIONS: TableSpec = {
  name: 'sessions',
  doc: 'The session dimension entity — a FK target referenced by nodes.session_id, never a node.',
  columns: [
    {
      name: 'id',
      sqlType: 'VARCHAR',
      doc: 'Session entity id (the value carried as nodes.session_id).',
    },
    { name: 'agent_id', sqlType: 'VARCHAR', doc: 'FK → agents.id.' },
    { name: 'user_id', sqlType: 'VARCHAR', doc: 'The user behind the session.' },
    { name: 'session_id', sqlType: 'VARCHAR', doc: "The harness's own session id." },
    { name: 'title', sqlType: 'VARCHAR', doc: 'Optional session title.' },
    // prettier-ignore
    { name: 'cwd', sqlType: 'VARCHAR', doc: 'Absolute working directory the session ran in. Populated for native Claude sessions; NULL for OTEL traces (no cwd attribute).' },
    // prettier-ignore
    { name: 'branch', sqlType: 'VARCHAR', doc: 'Git branch the session ran on. Populated for native Claude sessions; NULL for OTEL traces (no branch attribute).' },
  ],
};

export const TABLES: readonly TableSpec[] = [
  NODES,
  DELTAS,
  SEMANTICS,
  CONTAINMENT,
  CAUSAL_EDGES,
  THREADS,
  AGENTS,
  SESSIONS,
];
