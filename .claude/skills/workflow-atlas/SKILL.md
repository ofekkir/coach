---
name: workflow-atlas
description: >-
  Turn a Claude Code user's own session logs into a decorated "workflow atlas" —
  state machines of how they actually work (CHANGE / INVESTIGATE / OPS / DIRECT),
  every node stamped with times | minutes | output-tokens and pass/fail branch
  rates, plus a deviation-by-intent breakdown of how often work goes off the
  optimal path. Uses the coach MCP. Use when the request is "build my workflow
  state machine", "how do I actually work", "usage atlas", "analyze my agent
  workflows", or "where does my work go off the rails". Works on ANY repo, not
  just coach's own.
---

# Building a usage workflow atlas with coach

This skill reproduces, end to end, the analysis that turns raw Claude Code logs
into a decorated state-machine atlas of how a user works. It is **project-agnostic**
— point it at any repo. The output is a set of rendered PNG state machines plus a
deviation report.

## 0 — Prereqs: get coach running as MCP (one-time, per machine)

If `/mcp` does not list `coach`, install it. Coach is a TypeScript repo; the server
runs over stdio via Node's type-stripping. Use ABSOLUTE paths.

```bash
# clone + install once
git clone https://github.com/ofekkir/coach && cd coach && pnpm install

# register (no preload — we load the target repo at runtime)
claude mcp add coach -- node --experimental-strip-types \
  /ABSOLUTE/PATH/TO/coach/packages/mcp/bin/mcp.ts
```

Then restart Claude Code and confirm with `/mcp`. Remove later with
`claude mcp remove coach`. Rendering also needs `pnpm` (any repo) and a Chromium
(system Chrome is fine) + Python 3 with Pillow (`pip install pillow`).

## 1 — Load the target user's logs

```
load_dataset(repo: "<their-repo-name-or-abs-path>", includeWorktrees: true)
```

`repo` resolves the repo's Claude Code logs across the main checkout AND every git
worktree. Confirm the returned `sessions` / `interactions` / `nodes` counts are
non-trivial. Then `describe_schema` ONCE — the schema evolves; trust it over the
column names below if they ever disagree.

## 2 — Classify every interaction into a workflow family

This is the spine. One interaction → one family. Run as the basis for everything
after. (Worktree-normalized; `action` is the deterministic activity bucket.)

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
       WHEN f.vcs OR f.run THEN 'OPS'                -- only ran/committed
       ELSE 'OTHER' END AS family
FROM nodes n LEFT JOIN fam f ON f.interaction_id=n.id WHERE n.type='interaction';
```

Roll it up (interactions / hours / output-tokens per family) to learn where the
time goes and which families are worth drawing (skip a family with <~5% of time).

## 3 — Decorate each state: times | minutes | output-tokens

Per state = a tool bucket. Time and count come straight from tool nodes; **tokens
are attributed to the inference that EMITTED the call** via `causal_edges`, deduped
per (state, inference) so one turn's tokens aren't multiplied across its tools.
The CASE below is the canonical state mapping — keep `Gate`/`Verify` BEFORE the
generic `Run`, and keep file-mutating Bash (`BashMutate`) before `Run`.

```sql
WITH scope AS (  -- swap the family filter to target one workflow
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

The `Gate` bucket is repo-specific (`pnpm check`). Adapt it to the target repo's
real gate command (`make check`, `npm run ci`, `cargo test`, …) — find it from the
most common validation Bash commands before drawing.

## 4 — Branch frequencies for the decision diamonds (the back-edges)

The recovery edges are the most insightful labels. For each gating state, count
happy-path vs failure via `is_error`. These become edge labels like
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

## 5 — Deviation-by-intent: how often work goes off the optimal path

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

Caveats to STATE in the report: the two columns overlap (union ≠ sum); an
`is_error` can be a legitimate probe (a test meant to fail), so this is an UPPER
bound — offer to tighten to `not_found`/`invalid_args` on Edit/Write + redundancy
for the "genuinely preventable" subset.

## 6 — Draw the state machines (Mermaid)

Write one `stateDiagram-v2` per non-trivial family. Decorate each measurable node
with `<br/>=== {times}x | {minutes} min | {tok}k tok ===` and put branch
frequencies on the edges out of `<<choice>>` nodes. Leave decision/thinking/human
nodes blank but LABEL them with why (e.g. "judgment, no tool" / "human, off-trace")
so a blank never reads as a gap. The canonical CHANGE skeleton:

```
Orient -> (WorktreeSetup | Locate) -> ChangeCycle{Read->Edit->Run, back-edges to Read}
       -> Validation{Verify -> CoverageCheck -> Gate} -> Ship{commit->PR} -> Review(STOP)
```

Mutating loops back-edge to **Read**, not Edit (a `sed`/`rm`/`git mv` or a failed
run invalidates the read-cache; you must re-read before re-editing). See
`templates/change-loop.mmd` for a full decorated example to adapt.

## 7 — Render + assemble the atlas

```bash
# render one diagram to PNG (auto-detects system Chrome for puppeteer)
scripts/render-mermaid.sh path/to/diagram.mmd path/to/out.png
# stitch many PNGs into one titled atlas page
python3 scripts/build-atlas.py out/atlas.png "CHANGE:change.png" "REST:other.png" ...
```

Then `open out/atlas.png` (macOS) / `xdg-open` (Linux) and deliver the PNGs to the
user. Offer landscape (`LR`) re-render if the vertical scroll is too tall.

## Guardrails

- Numbers are tool-span wall-clock (excludes model thinking between calls) and
  EMITTING-inference output tokens (overlap across states; don't sum the token
  column to a workflow total). State both in the report.
- coach has zero `hook` nodes — deterministic PostToolUse hooks are invisible. A
  "build without verify" means no AGENT-issued check, not "no gate ran".
- Repo-specific buckets (`Gate`, test commands, file-type coverage for the
  TS/JS-only hook split) MUST be adapted to the target repo before drawing.
