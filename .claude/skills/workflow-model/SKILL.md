---
name: workflow-model
description: >-
  Use the coach MCP to visualize how a developer actually worked on a project across their
  Claude Code sessions, as a TOOL-LEVEL CAUSAL STATE MACHINE built from coach's semantic
  layer. States are the tools the developer ran (each `semantics.action`) plus the terminal
  `respond`; an edge is the single inference that bridges two tool calls (`tool → inference →
  tool`), i.e. the "think" between two acts — plus the direct `tool → respond`. Every edge is
  split by whether the SOURCE tool errored (ok vs error/recovery). States are labeled with
  visit count + total tool time; edges with transition count + the bridging inference's think
  time + tokens read (in) and produced (out). The coarse shell labels (`run`/`search`) are refined by
  clustering their `comment`s into 3-4 word acts — never a hardcoded taxonomy. The rendered
  diagram is the deliverable. Use when asked to "visualize my workflows", "show me how I work
  as a diagram", "draw my workflow state machine", "map how I develop", or "where does my work
  go off the path". Works on ANY repo.
---

# Visualizing a developer's workflows with coach

Coach ingests Claude Code traces into a **queryable database** with a **semantic layer**: the
`semantics` table holds **one row per atomic act** — an `action` label (input-independent: the
filename/program/query is stripped into `repo_path`/`package`/`url`), plus an optional `comment`
(e.g. a Bash `description`). This skill turns that into a **tool-level causal state machine**:

- **A state is a tool the developer ran** — its `semantics.action` (`read source code`,
  `edit source code`, `version control`, …) — plus the terminal **`respond`** (the one
  inference kept as a state).
- **An edge is the inference between two tools.** The causal flow is
  `tool_A → inference → tool_B`: the model read tool_A's result, thought, and called tool_B.
  That one "think" step **is the edge** — so the token cost of reasoning lands on transitions,
  while the cheap tool spans are the states.

**Principles — violate them and the diagram lies:**

1. **States and edges come from the SEMANTIC LAYER + `causal_edges`, never invented.** A state
   is a tool's `semantics.action` (or a comment-derived refinement of it); an edge exists
   because a 2-hop causal path connects two tools. Derive from THIS DB — a different project
   has a different vocabulary. Labels below (`read source code`, `run full check`, …) are
   **example output**, not a taxonomy to apply.

2. **Refine the coarse shell labels from the `comment`.** Every Bash call collapses to bare
   `run` or `search` (the program is stripped out), which is too coarse — a `run` is anything
   from `cat` to `pnpm check` to `rm`. The **`comment`** is the only intent signal; cluster the
   recurring shell comments into 3-4 word acts (`run full check`, `list files`, `deploy to
production`) and relabel. One-off comments stay as bare `run`/`search`.

3. **Edges are exactly the 2-hop tool→tool bridge, plus the direct tool→respond.** No tool→tool
   is direct in the causal DAG — it always passes through one inference (fan-in then fan-out).
   `respond` is reached at distance 1 (`tool → respond`). Every edge is **split by whether the
   SOURCE tool errored** — the error edge is the recovery path.

## 0 — Setup

If `/mcp` doesn't list `coach`, install it — see
**[INSTALL.md](https://github.com/ofekkir/coach/blob/main/INSTALL.md)**. The machine is dense
(~70–90 states), so render with **Graphviz** (`dot`) — Mermaid OOMs its renderer past ~150
nodes. `brew install graphviz` (or apt). Queries that exceed the MCP 1000-row cap run over the
dumped `graph.db` with the `duckdb` CLI.

## 1 — Load

```
load_dataset(repo: "<repo-name-or-abs-path>", includeWorktrees: true)
```

Check counts are non-trivial, then `describe_schema` ONCE — the source of truth for
tables/columns. Key surfaces: `semantics(id, sequence_in_node, action, comment, …)` — one row
per act, joined to `nodes` by `id`; `nodes`/`tools` carry `is_error`, `duration_ms`,
`tokens_in`, `tokens_out`; `causal_edges(from_id, to_id)` is the DAG. The directory load also
dumps `out/graph.db` (a DuckDB file) — query it with the `duckdb` CLI for the heavy steps.

## 2 — Refine shell labels: cluster comments → 3-4 word acts

`run`/`search` are too coarse. Extract the **recurring** shell comments and cluster each into a
short input-independent act, exactly like the structured actions:

```sql
SELECT COUNT(*) freq, any_value(action) act, comment
FROM semantics WHERE comment IS NOT NULL AND action IN ('run','search')
GROUP BY comment HAVING COUNT(*) >= 2 ORDER BY freq DESC;
```

Cluster the result (the LLM step) — e.g. "Run full check suite" / "Run full CI gate" /
"Confirm full check passes" → `run full check`; "Push branch to origin" / "Push to remote" →
`push branch`. **Persist the map** to a TSV (`what⇥comment`) so it is inspectable and reusable;
one-off comments are left unmapped (they stay bare `run`/`search`). Build it once; every later
query joins it.

```
# comment_whats.tsv
what⇥comment
run full check⇥Run full check suite
push branch⇥Push branch to origin
…
```

## 3 — States: count + total time

A state is a (possibly relabeled) tool action, plus `respond`. The shared relabel CTE `tn`
(reused in §4):

```sql
WITH map AS (SELECT what, comment FROM read_csv_auto('comment_whats.tsv', sep='\t', header=true)),
tn AS (                                       -- every tool node, relabeled
  SELECT n.id,
         CASE WHEN s.action IN ('run','search') AND m.what IS NOT NULL THEN m.what ELSE s.action END AS act,
         n.duration_ms, n.tokens_in, n.tokens_out, COALESCE(n.is_error,false) AS err
  FROM nodes n JOIN semantics s ON s.id=n.id AND s.sequence_in_node=0
  LEFT JOIN map m ON m.comment = s.comment
  WHERE n.type='tool'),
rn AS (SELECT n.id, n.duration_ms FROM nodes n JOIN semantics s ON s.id=n.id
       WHERE n.type='llm_request' AND s.action='respond')
SELECT act AS state, COUNT(*) visits, ROUND(SUM(duration_ms)/60000,1) min FROM tn GROUP BY act
UNION ALL
SELECT 'respond', COUNT(*), ROUND(SUM(duration_ms)/60000,1) FROM rn
ORDER BY visits DESC;
```

State label = `{visits}x · {min}m`. (Tool spans are cheap; the costly time is `respond` and
the per-edge token cost below.)

## 4 — Edges: 2-hop tool→tool + tool→respond, split by source-tool error

Two edge kinds, each split by whether the **source tool** errored. The edge's time + tokens are
the **bridging inference's** `duration_ms`, `tokens_in` (read) and `tokens_out` (produced) —
the "think" between the two tools; for `tool → respond` the bridge is the `respond` node itself.

```sql
WITH map AS (SELECT what, comment FROM read_csv_auto('comment_whats.tsv', sep='\t', header=true)),
tn AS (
  SELECT n.id,
         CASE WHEN s.action IN ('run','search') AND m.what IS NOT NULL THEN m.what ELSE s.action END AS act,
         COALESCE(n.is_error,false) AS err
  FROM nodes n JOIN semantics s ON s.id=n.id AND s.sequence_in_node=0
  LEFT JOIN map m ON m.comment = s.comment
  WHERE n.type='tool'),
rn AS (SELECT n.id, n.tokens_in, n.tokens_out FROM nodes n JOIN semantics s ON s.id=n.id
       WHERE n.type='llm_request' AND s.action='respond'),
tt AS (                                        -- tool_A → inference m → tool_B
  SELECT ta.act src, tb.act dst, CASE WHEN ta.err THEN 1 ELSE 0 END e,
         COUNT(*) cnt, ROUND(SUM(m.duration_ms)/60000,1) min, SUM(m.tokens_in) tin, SUM(m.tokens_out) tout
  FROM causal_edges e1 JOIN nodes m ON m.id=e1.to_id AND m.type='llm_request'
  JOIN causal_edges e2 ON e2.from_id=m.id
  JOIN tn ta ON ta.id=e1.from_id JOIN tn tb ON tb.id=e2.to_id
  GROUP BY ta.act, tb.act, ta.err),
tr AS (                                        -- tool_A → respond (direct)
  SELECT ta.act src, 'respond' dst, CASE WHEN ta.err THEN 1 ELSE 0 END e,
         COUNT(*) cnt, ROUND(SUM(r.duration_ms)/60000,1) min, SUM(r.tokens_in) tin, SUM(r.tokens_out) tout
  FROM causal_edges ed JOIN tn ta ON ta.id=ed.from_id JOIN rn r ON r.id=ed.to_id
  GROUP BY ta.act, ta.err)
SELECT * FROM tt UNION ALL SELECT * FROM tr;
```

Edge label = `{✗ if error}{cnt} | {min}m | {tin}k in · {tout}k out` — transition count, total
think-time, tokens read, tokens out. The **error edges are the recovery structure** — e.g.
`edit source code ✗→ read source code` is "edit failed, go re-read".

> **Fan-out caveat — state it.** A bridging inference with _I_ incoming tools and _O_ outgoing
> tools sits on _I×O_ tool→tool pairs, so its time + tokens are summed once **per pair**: the
> `cnt` is a true path count, but the time/token sums over-count across fan-out and exceed real
> spend (~10% of coach inferences fan out). `is_error` NULL (no matched result) is treated as ok.

## 5 — Render (Graphviz)

Emit a `.dot`: nodes `{state}\n{visits}x · {min}m`; edges `{cnt} | {min}m | {tin}k in · {tout}k out`;
ok edges grey/amber (tint `→respond`), **error edges red dashed** with a `✗`; `penwidth` ∝ √count.
Color tool families (read/search
blue, edit/write green, verify/test purple, version-control pink) and outline the
comment-derived states so the shell refinement is visible. Then:

```bash
dot -Tsvg graph.dot -o out/graph.svg     # vector + zoomable — the right format when dense
dot -Tpng -Gsize="34,34\!" graph.dot -o out/thumb.png   # capped PNG (full PNG can be >50MB)
```

The full machine is too dense to read at fit-scale — also emit a **readable focus**: the
comment-derived states + the spine they touch, edges above a count threshold. Generate the
`.dot` straight from the §3/§4 SQL (pipe `duckdb out/graph.db -noheader -csv`). Open the SVG and
deliver both.

## Guardrails

- **Never hardcode the vocabulary** — re-derive states from this DB, and re-cluster the shell
  comments every run (other projects: data→`research`/`mcp`, web→`browser`).
- **States are tools (+ `respond`); edges are the inference between tools.** Token cost lives on
  the EDGE (the think step), tool time on the state. `respond` is the only llm state.
- **Edges = 2-hop `tool→inference→tool`, plus direct `tool→respond`.** No tool→tool is direct;
  count one transition per `(tool_A, inference, tool_B)`.
- **Every edge is split by SOURCE-tool error.** The error edge back to an earlier state is the
  recovery loop — the most insightful label.
- **Shell `run`/`search` are coarse** (program stripped into `bash_command`/`comment`); refine
  from the `comment`. No comment → intent is unknowable; it stays bare `run`/`search`.
- Mind the fan-out token over-count (above). Don't sum edge tokens to a grand total.
- Mermaid can't render past ~150 nodes — use Graphviz.
- coach has zero `hook` nodes — deterministic PostToolUse hooks are invisible; "no verify"
  means no AGENT-issued check, not "no gate ran".
