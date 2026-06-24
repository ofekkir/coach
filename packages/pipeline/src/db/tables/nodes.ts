// The `nodes` table spec — the unified, harness-agnostic node table. The largest
// spec, in its own file so it has room to grow without crowding the aggregator.

import type { TableSpec } from '../spec.ts';

export const NODES: TableSpec = {
  name: 'nodes',
  doc: 'One row per CanonicalNode — the unified, harness-agnostic node table. Common columns are promoted; type-specific columns are populated only for the relevant `type` and NULL otherwise; `data` carries the full raw node for anything not promoted. Per-type VIEWs (`llm_requests` / `tools` / `interactions`) project this table to the columns of one type with the irrelevant NULLs dropped.',
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
    // prettier-ignore
    { name: 'start_time_ns', sqlType: 'BIGINT', doc: 'Span start in nanoseconds (the `_ns` names the unit). BIGINT holds the full int64 ns value losslessly (a DOUBLE/JS number would not); the same digits survive verbatim in `data`. ORDER BY start_time_ns == ORDER BY seq within an interaction.' },
    // prettier-ignore
    { name: 'end_time_ns', sqlType: 'BIGINT', doc: 'Span end in nanoseconds (BIGINT, full-precision int64).' },
    // prettier-ignore
    { name: 'seq', sqlType: 'INTEGER', doc: 'Dense 0..n-1 rank of this node within its owning interaction (every node sharing interaction_id), by start_time_ns ascending, ties broken by id — a deterministic TOTAL order where start_time_ns alone is only partial (ties possible). The materialized form of ROW_NUMBER() OVER (PARTITION BY interaction_id ORDER BY start_time_ns, id): a gap-free positional index for "n-th step" / "next step" (seq+1) arithmetic and adjacency self-joins.' },
    { name: 'duration_ms', sqlType: 'DOUBLE', doc: 'Span wall-clock in ms.' },
    { name: 'model', sqlType: 'VARCHAR', doc: 'llm_request: model id.' },
    { name: 'source', sqlType: 'VARCHAR', doc: 'llm_request: emitting loop/source.' },
    { name: 'stop_reason', sqlType: 'VARCHAR', doc: 'llm_request: stop reason, when present.' },
    {
      name: 'tokens_in',
      sqlType: 'DOUBLE',
      doc: 'llm_request: uncached input tokens (the delta billed at the full input rate).',
    },
    { name: 'tokens_out', sqlType: 'DOUBLE', doc: 'llm_request: output tokens.' },
    // prettier-ignore
    { name: 'cache_read_tokens', sqlType: 'DOUBLE', doc: 'llm_request: Anthropic prompt-cache READ input tokens (cache_read_input_tokens), billed ~0.1×. 0 when absent.' },
    // prettier-ignore
    { name: 'cache_creation_tokens', sqlType: 'DOUBLE', doc: 'llm_request: Anthropic prompt-cache WRITE input tokens (cache_creation_input_tokens), billed ~1.25×. 0 when absent.' },
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
      doc: "tool: closed activity bucket, NON-NULL for every tool node — 'explore'|'author'|'edit'|'run'|'test'|'verify'|'vcs'|'setup'|'mcp'|'meta'|'research'|'delegate'|'plan'|'other'. Deterministically derived from (name, bash command); GROUP BY it for stable counts. Coarse dimension, distinct from the free-form semantics.what.",
    },
    // prettier-ignore
    { name: 'is_error', sqlType: 'BOOLEAN', doc: "tool: did the matched tool_result carry is_error=true? Matched by tool_use_id from the consuming inference's request messages. NULL when no result was matched (those stay NULL, queryable as such)." },
    // prettier-ignore
    { name: 'error_kind', sqlType: 'VARCHAR', doc: "tool: deterministic error class (no LLM) — 'not_found' | 'invalid_args' | 'permission' | 'timeout' | 'nonzero_exit' | 'other'. NULL when the call succeeded or had no matched result. Count Edit/Write rows WHERE is_error for the misleading-file (failed-edits-per-file) signal." },
    // prettier-ignore
    { name: 'output_size', sqlType: 'INTEGER', doc: 'tool: character length of the tool_result content (success or error). NULL when no result was matched. A cheap size signal — the success content itself is not stored.' },
    // prettier-ignore
    { name: 'error_message', sqlType: 'VARCHAR', doc: 'tool: ≤500-char summary of the error text, set ONLY on failures (is_error=true). NULL for successes and unmatched calls.' },
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
      doc: "The full raw CanonicalNode. Escape hatch for un-promoted fields, e.g. request_messages / response_messages, and the verbatim start_time_ns / end_time_ns digit strings. Reach in with json_extract / data->>'$.field'.",
    },
  ],
};
