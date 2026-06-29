---
name: workflow-model
description: >-
  Use the coach MCP to analyze how a developer actually worked on a project across
  their Claude Code sessions, and produce a workflow model: a state machine of their
  recurring workflows (CHANGE / INVESTIGATE / OPS / DIRECT) with every state and
  transition decorated by how much it cost — count, wall-clock, output tokens — plus
  pass/fail branch rates and a deviation-by-intent breakdown. Use when asked to
  "model how I work", "build my workflow state machine", "analyze my development on
  this project", or "where does my work go off the path". Works on ANY repo.
---

# Modeling a developer's workflows with coach

Coach turns Claude Code execution traces into a queryable **execution graph**. This
skill aggregates that graph across a developer's sessions into a higher-level
**workflow model** — a state machine of how they actually work, where each state and
transition is decorated with its cost. The rendered graph is the deliverable
(Mermaid for now; the technique is renderer-agnostic).

## 0 — Get coach running as MCP (one-time, per machine)

If `/mcp` does not list `coach`, install it. Coach is a TypeScript repo; the server
runs over stdio via Node's type-stripping. Use ABSOLUTE paths.

```bash
git clone https://github.com/ofekkir/coach && cd coach && pnpm install
# register with no preload — we load the target project at runtime
claude mcp add coach -- node --experimental-strip-types \
  /ABSOLUTE/PATH/TO/coach/packages/mcp/bin/mcp.ts
```

Restart Claude Code, confirm with `/mcp`. Remove later: `claude mcp remove coach`.
Rendering needs `pnpm` and a Chromium (system Chrome is fine).

## 1 — Load the developer's logs for the target project

```
load_dataset(repo: "<repo-name-or-abs-path>", includeWorktrees: true)
```

Loads the repo's Claude Code logs across the main checkout AND every git worktree.
Check the returned `sessions` / `interactions` / `nodes` counts are non-trivial,
then call `describe_schema` ONCE — the schema is the source of truth; trust it over
the column names below if they ever disagree.

## 2 — Classify every interaction into a workflow family

One interaction → one family. This is the spine of the state machine.

```sql
WITH fam AS (
  SELECT interaction_id,
    BOOL_OR(action IN ('author','edit')) AS cl,
    BOOL_OR(action='explore') AS expl,
    BOOL_OR(action='run') AS run, BOOL_OR(action='vcs') AS vcs
  FROM nodes WHERE type='tool' AND action IS NOT NULL GROUP BY interaction_id
)
SELECT n.id AS interaction_id,
  CASE WHEN f.interaction_id IS NULL THEN 'DIRECT'   -- no tools: pure Q&A
       WHEN f.cl   THEN 'CHANGE'                     -- authored or edited code
       WHEN f.expl THEN 'INVESTIGATE'                -- explored, no writes
       WHEN f.vcs OR f.run THEN 'OPS'                -- only ran / committed
       ELSE 'OTHER' END AS family
FROM nodes n LEFT JOIN fam f ON f.interaction_id=n.id WHERE n.type='interaction';
```

Roll up per family (interactions / hours / output-tokens) to see where the work
goes; draw a state machine only for families above ~5% of time.

## 3 — Cost per state and per transition

Each state is a tool bucket. Count and wall-clock come straight from tool nodes;
**tokens are attributed to the inference that EMITTED the call** via `causal_edges`,
deduped per (state, inference) so one turn's tokens are not multiplied across its
tools. Keep `Gate`/`Verify` before the generic `Run`, and `BashMutate` before `Run`.

```sql
WITH scope AS (  -- swap the filter to target one family (here: CHANGE)
  SELECT DISTINCT interaction_id FROM nodes WHERE type='tool' AND action IN ('author','edit')
),
tmap AS (
  SELECT t.id, t.duration_ms, ce.from_id AS inf,
    CASE
      WHEN t.name='Read' THEN 'Read'
      WHEN t.name IN ('Grep','Glob','LS') THEN 'Search'
      WHEN t.name='Write' THEN 'Author'
      WHEN t.name IN ('Edit','MultiEdit','NotebookEdit') THEN 'Edit'
      WHEN t.name='Bash' AND t.bash_command LIKE '%pnpm check%' THEN 'Gate'
      WHEN t.action IN ('test','verify') THEN 'Verify/Test'
      WHEN t.name='Bash' AND (t.bash_command LIKE '%rm %' OR t.bash_command LIKE '%sed %'
           OR t.bash_command LIKE '%perl %' OR t.bash_command LIKE '%git mv%') THEN 'BashMutate'
      WHEN t.action='vcs' THEN 'VCS'
      WHEN t.action='run' THEN 'Run'
      WHEN t.name LIKE 'mcp__%' OR t.action='mcp' THEN 'MCP'
      WHEN t.action='explore' THEN 'Search'
      ELSE 'other'
    END AS state
  FROM nodes t LEFT JOIN causal_edges ce ON ce.to_id=t.id
  WHERE t.type='tool' AND t.interaction_id IN (SELECT interaction_id FROM scope)
),
tok AS (
  SELECT state, SUM(tokens_out) AS out_tok FROM (
    SELECT DISTINCT m.state, m.inf, n.tokens_out
    FROM tmap m JOIN nodes n ON n.id=m.inf AND n.type='llm_request'
  ) GROUP BY state
)
SELECT m.state, COUNT(*) AS times, ROUND(SUM(m.duration_ms)/60000.0,1) AS minutes,
       COALESCE(k.out_tok,0) AS output_tokens
FROM tmap m LEFT JOIN tok k ON k.state=m.state GROUP BY m.state, k.out_tok
ORDER BY minutes DESC;
```

For **transition cost** (the edges), measure each `state[seq] -> state[seq+1]`
adjacency within an interaction — count how often the transition is taken and the
wall-clock spent in the destination state. Adjacent steps share `interaction_id`
and order by `seq`; self-join on `seq+1` to weight each edge.

The `Gate` bucket is repo-specific (`pnpm check`). Adapt it to the target repo's
real gate (`make check`, `npm run ci`, `cargo test`, …) — find it from the most
common validation Bash commands before drawing.

## 4 — Branch frequencies for the decision points

The recovery edges are the most insightful labels. For each gating state, count
happy-path vs failure via `is_error`; these become edge labels like
`rejected 56x` / `applied 1510x`.

```sql
WITH t AS (SELECT * FROM nodes WHERE type='tool'
           AND interaction_id IN (SELECT DISTINCT interaction_id FROM nodes
                                  WHERE type='tool' AND action IN ('author','edit')))
SELECT
  COUNT(*) FILTER (WHERE name IN ('Edit','MultiEdit') AND is_error) AS edit_rejected,
  COUNT(*) FILTER (WHERE name IN ('Edit','MultiEdit') AND (is_error IS NULL OR NOT is_error)) AS edit_applied,
  COUNT(*) FILTER (WHERE action='run' AND is_error) AS run_fail,
  COUNT(*) FILTER (WHERE name='Bash' AND bash_command LIKE '%pnpm check%' AND is_error) AS gate_red,
  COUNT(*) FILTER (WHERE name='Bash' AND bash_command LIKE '%pnpm check%' AND (is_error IS NULL OR NOT is_error)) AS gate_green,
  COUNT(*) FILTER (WHERE action='vcs' AND is_error) AS vcs_fail
FROM t;
```

## 5 — Deviation-by-intent: how often work goes off the path

An interaction "deviates" if it has any tool error OR redundant calls (identical
`(name, tool_input)` ≥2× = wasted work). Report per `intent_category`.

```sql
WITH redundant AS (
  SELECT interaction_id FROM (
    SELECT interaction_id, name, tool_input, COUNT(*) c FROM nodes WHERE type='tool'
    GROUP BY interaction_id, name, tool_input HAVING COUNT(*) >= 2
  ) GROUP BY interaction_id
)
SELECT i.intent_category, COUNT(*) AS total,
  COUNT(*) FILTER (WHERE m.error_count>0 OR r.interaction_id IS NOT NULL) AS deviating,
  ROUND(100.0*COUNT(*) FILTER (WHERE m.error_count>0 OR r.interaction_id IS NOT NULL)/COUNT(*),0) AS pct,
  COUNT(*) FILTER (WHERE m.error_count>0) AS with_errors,
  COUNT(*) FILTER (WHERE r.interaction_id IS NOT NULL) AS with_redundancy
FROM interactions i JOIN interaction_metrics m ON m.interaction_id=i.id
LEFT JOIN redundant r ON r.interaction_id=i.id
GROUP BY i.intent_category ORDER BY deviating DESC;
```

State these caveats in the report: the columns overlap (union ≠ sum); an
`is_error` can be a legitimate probe (a test meant to fail), so this is an UPPER
bound — offer to tighten to `not_found`/`invalid_args` on Edit/Write + redundancy
for the "genuinely preventable" subset.

## 6 — Draw the state machine (Mermaid)

Write one `stateDiagram-v2` per non-trivial family. Decorate each measurable state
with `<br/>=== {times}x | {minutes} min | {tok}k tok ===`, and label each transition
with its frequency and cost (e.g. `rejected 56x`, `applied 1510x`). Leave
decision/thinking/human states blank but LABEL why (e.g. "judgment, no tool" /
"human, off-trace") so a blank never reads as a gap. Canonical CHANGE skeleton —
note mutating loops back-edge to **Read**, not Edit (a `sed`/`rm`/`git mv` or a
failed run invalidates the read-cache; re-read before re-editing):

```mermaid
stateDiagram-v2
    [*] --> Locate
    Locate: Search === Nx | M min | K tok ===
    Locate --> Read
    Read: Read target === Nx | M min | K tok ===
    Read --> Edit
    Edit: Edit / author === Nx | M min | K tok ===
    state EditRes <<choice>>
    Edit --> EditRes
    EditRes --> Read: rejected Nx (stale)
    EditRes --> Run: applied Nx
    Run: Run check === Nx | M min | K tok ===
    state RunRes <<choice>>
    Run --> RunRes
    RunRes --> Read: fail Nx
    RunRes --> Gate: pass Nx
    Gate: Gate (repo check) === Nx | M min | K tok ===
    state GateRes <<choice>>
    Gate --> GateRes
    GateRes --> Read: red Nx
    GateRes --> Ship: green Nx
    Ship: Commit + PR === Nx | M min | K tok ===
    Ship --> Review
    Review: STOP - human review (off-trace)
    Review --> [*]
```

## 7 — Render

```bash
node --experimental-strip-types scripts/render-mermaid.ts diagram.mmd out/diagram.png
```

The TypeScript helper auto-detects system Chrome for mermaid-cli's renderer. Open
the PNG (`open` on macOS, `xdg-open` on Linux) and deliver it with the analysis.

## Guardrails

- Numbers are tool-span wall-clock (excludes model thinking between calls) and
  EMITTING-inference output tokens (overlap across states; don't sum the token
  column to a workflow total). State both in the report.
- coach has zero `hook` nodes — deterministic PostToolUse hooks are invisible. A
  "build without verify" means no AGENT-issued check, not "no gate ran".
- Repo-specific buckets (`Gate`, test commands, file-type coverage for any
  hook-coverage split) MUST be adapted to the target repo before drawing.
