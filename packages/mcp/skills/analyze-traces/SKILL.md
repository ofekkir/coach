---
name: analyze-traces
description: >-
  Analyze agent OTEL/native traces with the coach MCP to find harness bottlenecks —
  edit-failure friction, file read/write hotspots, co-edit coupling, recovery cost,
  cost/token/latency rollups — and visualize an exemplar. Use whenever the request is
  "analyze my agent traces", "find bottlenecks", "what did the agent waste time on", or
  any cost/error/coupling attribution over coach data.
---

# Analyze agent traces with coach

The **coach** MCP server turns a directory of agent traces (OTEL Tempo JSON or native
`.jsonl` session logs) into a normalized, id-keyed relational execution graph and exposes
it as read-only SQL plus graph traversal. You drive the analysis — there is no fixed
"findings" tool; every rollup is a query you compose over the documented tables.

## Tools (verify against `describe_schema`)

| Tool              | Purpose                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `describe_schema` | Tables, columns (with docs), semantic vocabulary, and example SQL. Works with no dataset loaded — **call this first**.        |
| `load_dataset`    | Run the pipeline over a directory (`path`) and make its graph queryable. Replaces any prior dataset. Returns counts.          |
| `query`           | Run one read-only `SELECT`/`WITH` statement over the tables/views. Results are capped.                                        |
| `resolve`         | Resolve one node `id` across all layers (node data + message deltas + semantic label).                                        |
| `subtree`         | Containment descendants of a node `id` (what ran within its span).                                                            |
| `causal_path`     | Walk the causal DAG from a node `id`: `upstream` (causes, default) or `downstream`.                                           |
| `open_viz`        | Open the interactive React Flow graph in the browser for a dumped stage file + optional `focus` node. Requires the built app. |

## Workflow

1. **`describe_schema`** — read the tables, columns, vocabulary, and `exampleQueries`. The
   examples already encode the stage-7 detectors as SQL; extend them rather than guessing
   column names.
2. **`load_dataset`** with an absolute `path` to a directory of traces. If coach was started
   with a preloaded directory you can skip this. With no path configured, the sensible default
   is your own Claude Code logs at `~/.claude/projects`.
3. **`query`** to compute rollups; **`subtree`** / **`causal_path`** to walk structure;
   **`resolve`** to hydrate a single node you found.
4. **`open_viz`** (optional) on an exemplar interaction to show the engineer the shape.

## Proven query recipes

Cost / token / latency per session:

```sql
SELECT session_id, SUM(cost_usd) AS cost_usd, SUM(tokens_in) AS tokens_in,
       SUM(tokens_out) AS tokens_out,
       COUNT(*) FILTER (WHERE type='llm_request') AS llm_calls,
       COUNT(*) FILTER (WHERE type='tool') AS tool_calls
FROM nodes GROUP BY session_id ORDER BY cost_usd DESC
```

Misleading files — most failed Edit/Write calls per file (edit-failure friction):

```sql
SELECT file_path, COUNT(*) AS failed_edits, list(id) AS node_ids
FROM nodes
WHERE type='tool' AND is_error AND name IN ('Edit','Write','MultiEdit','NotebookEdit')
GROUP BY file_path ORDER BY failed_edits DESC
```

Redundant tool calls — identical `(name, tool_input)` ≥2× in one interaction:

```sql
SELECT interaction_id, name, tool_input, COUNT(*) AS occurrences,
       SUM(duration_ms) - MAX(duration_ms) AS approx_wasted_ms, list(id) AS occurrence_ids
FROM nodes WHERE type='tool'
GROUP BY interaction_id, name, tool_input HAVING COUNT(*) >= 2 ORDER BY occurrences DESC
```

Pre-aggregated per-interaction metrics (use the view, don't recompute):

```sql
SELECT interaction_id, shape, tool_count, llm_count, tokens_in, tokens_out,
       cost_usd, duration_ms, first_action, last_action, distinct_files, error_count
FROM interaction_metrics ORDER BY duration_ms DESC
```

Reach un-promoted fields via the JSON escape hatch:

```sql
SELECT id, json_extract_string(data, '$.stop_reason') AS stop_reason
FROM nodes WHERE type='llm_request'
```

## Gotchas (these will bite you)

- **Check truncation, not just rows.** The result caps at ≤1000 rows and a byte budget. Compare
  the total `rowCount` against the rows you actually received and read `truncated` / `notice` —
  if `truncated` is true, aggregate or `LIMIT` server-side instead of trusting `rows.length`.
- **No leading SQL comments.** The guard expects the statement to begin with `SELECT` or `WITH`.
  A leading `-- comment` line makes the query reject. One statement only — no `;`-separated
  statements, no DDL/DML.
- **Tool _success_ output is not stored.** Only failures carry an error payload. To see what a
  successful tool produced, mine the message `deltas` (via `resolve`) or the `data` JSON column —
  don't expect a `result` column on the tool node.
- **`repo_path` is worktree-normalized.** Paths are grounded by repo-relative path, so a file
  edited in a git worktree resolves to the same `repo_path`/`file_path` as in the main checkout.
  Group by `file_path` to attribute across worktrees.
- **`open_viz` needs the built app.** It serves `@coach/app`'s `dist`; if it isn't built it errors
  with a build hint. Querying does not require it.
