// The `nodes` table spec — the unified, harness-agnostic node table. Extracted
// from schema.ts (which stays the TABLES aggregator + describe_schema source) so
// the largest spec has room to grow without tripping the per-file line cap.

import type { TableSpec } from './schema.ts';

export const NODES: TableSpec = {
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
    // prettier-ignore
    { name: 'file_path', sqlType: 'VARCHAR', doc: 'tool: the file path a path-bearing file tool targets (Read/Edit/Write → file_path, NotebookEdit → notebook_path), promoted from tool_input. NULL for non-file tools and on malformed input.' },
    // prettier-ignore
    { name: 'bash_command', sqlType: 'VARCHAR', doc: 'tool: the shell command a Bash tool runs, promoted from tool_input.command. NULL for non-Bash tools and on malformed input. Invariant: every name=\'Bash\' node carries a non-NULL command.' },
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
    // prettier-ignore
    { name: 'intent_category', sqlType: 'VARCHAR', doc: "interaction: closed intent bucket, NON-NULL for every interaction node — 'debug'|'feature'|'refactor'|'explain'|'test'|'ops'|'research'|'other'. Deterministically derived from the prompt by the stage-6 labeler; GROUP BY it for stable per-intent counts. NULL for non-interaction nodes." },
    {
      name: 'data',
      sqlType: 'JSON',
      doc: "The full raw CanonicalNode. Escape hatch for un-promoted fields, e.g. request_messages / response_messages. Reach in with json_extract / data->>'$.field'.",
    },
  ],
};
