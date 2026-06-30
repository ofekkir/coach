---
name: workflow-model
description: >-
  Use the coach MCP to visualize how a developer actually worked on a project across
  their Claude Code sessions, as a CAUSAL STATE MACHINE built from coach's semantic layer.
  The `semantics` table is one row per act (`action` = an input-independent label, the
  argument stripped into `repo_path`/`url`) plus an optional `comment`; states and edges
  are derived from those plus `causal_edges` — never a hardcoded taxonomy. The model is the
  atom-level machine (one state per distinct act), optionally merged one level so each
  `invoke X` folds into the tool `X` it dispatched (dropping the inference↔tool relay),
  decorating states with the INFERENCE's real cost (output tokens + wall-clock) and edges
  with action + pass/fail outcome. The rendered diagram is the deliverable. Use when asked to "visualize my
  workflows", "show me how I work as a diagram", "draw my workflow state machine", "map how
  I develop", or "where does my work go off the path". Works on ANY repo.
---

# Visualizing a developer's workflows with coach

Coach ingests Claude Code traces into a **queryable database** with a **semantic layer**:
the `semantics` table holds **one row per atomic act** — an `action` label (input-independent:
the filename/program/query is stripped out, into `repo_path`/`package`/`url`), ordered within
its node by `sequence_in_node`, plus an optional `comment` (e.g. a Bash `description`). A node
maps to N rows (an inference that fires three tools → three rows). This skill turns that into a
**causal state machine** at the **atom level** (one state per distinct act), optionally
**merged one level** so each `invoke X` folds into the tool `X` it dispatched.

**Principles — violate them and the diagram lies:**

1. **States and edges come from the SEMANTIC LAYER + `causal_edges`, never invented.** A
   state is a semantic act (a `semantics.action`); an edge exists because a `causal_edges`
   row connects two nodes, weighted by how many. Derive from THIS DB — a different project
   has a different vocabulary.

2. **The inference is the unit of work, not the tool.** Cost lives on the inference (in
   coach's logs ~1200 min of inference wall-clock vs ~200 min of tool spans; 100% of output
   tokens are on inferences) and so does intent (`plan`, `respond` exist ONLY on the
   inference). The tool is the inference's effect.

3. **Order is the causal DAG, not `seq`.** A node's flow is
   `inference →(fan-out)→ tool(s) →(fan-in)→ inference`. One inference fans out to 1–N
   parallel tools (unordered — `seq` among them is meaningless) that re-converge to ONE
   next inference. Walk `causal_edges`.

## 0 — Setup

If `/mcp` doesn't list `coach`, install it — see
**[INSTALL.md](https://github.com/ofekkir/coach/blob/main/INSTALL.md)**. The atom-level
machine is dense (~140 states), so render it with **Graphviz** (`dot`) — Mermaid OOMs its
renderer past ~150 nodes. `brew install graphviz` (or apt).

## 1 — Load

```
load_dataset(repo: "<repo-name-or-abs-path>", includeWorktrees: true)
```

Check counts are non-trivial, then `describe_schema` ONCE — it is the source of truth for
tables/columns; trust it over anything below. Key surfaces: `semantics(id, sequence_in_node,
action, repo_path, package, url, comment)` — one row per act, joined to `nodes` by `id`;
`causal_edges(from_id, to_id)`; `nodes`/`llm_requests`/`tools`. Note `action`/`repo_path` are
**no longer on `nodes`** (they moved to `semantics`); `tools` is a view that joins back for them.

## 2 — Build the atom-level causal state machine

Each `semantics` row is **already one atomic act** (`action`), ordered within its node by
`sequence_in_node` — no array splitting (the old `what` array is gone). Because the label is
input-independent, the vocabulary is compact (coach: ~140 distinct atoms). Build edges from
`causal_edges` with these rules — **the `invoke X` rule is the important one**:

- **Fan-out `invoke X → X`** — every `invoke X` atom has EXACTLY ONE outgoing edge, to the
  tool `X` it dispatched (from `causal_edges` inference→tool). An inference's other atoms
  (`plan`, a second `invoke Y`) are co-occurring, NOT successors of `invoke X`.
- **Co-occur `plan/respond → invoke …`** — a non-invoke act in the same node points at the
  invokes it precedes.
- **Fan-in `X → next inference's entry`** — the tool `X` points at the first atom of the
  inference it fans into (`causal_edges` tool→inference).

```sql
WITH atoms AS (SELECT id, sequence_in_node AS pos, action AS atom FROM semantics),  -- already one row per act
toolatom AS (SELECT a.id, a.atom FROM atoms a JOIN nodes n ON n.id=a.id WHERE n.type='tool'),
infentry AS (SELECT a.id, arg_min(a.atom,a.pos) atom FROM atoms a JOIN nodes n ON n.id=a.id WHERE n.type='llm_request' GROUP BY a.id),
r1 AS (SELECT 'invoke '||t.atom s, t.atom d FROM causal_edges e JOIN toolatom t ON t.id=e.to_id JOIN nodes n ON n.id=e.from_id AND n.type='llm_request'),  -- invoke X -> X
r2 AS (SELECT a1.atom s, a2.atom d FROM atoms a1 JOIN atoms a2 ON a1.id=a2.id AND a2.pos>a1.pos WHERE a1.atom NOT LIKE 'invoke %'),                          -- plan/respond -> invokes
r3 AS (SELECT t.atom s, ie.atom d FROM causal_edges e JOIN toolatom t ON t.id=e.from_id JOIN infentry ie ON ie.id=e.to_id)                                   -- X -> next inference entry
SELECT s, d, COUNT(*) w FROM (SELECT s,d FROM r1 UNION ALL SELECT s,d FROM r2 UNION ALL SELECT s,d FROM r3) WHERE s<>d GROUP BY s,d ORDER BY w DESC;
```

**Sanity check:** every `invoke …` state must have out-degree 1 (only `→ X`). If not, the
co-occurrence chaining leaked — fix before rendering.

## 3 — (optional) Merge the invoke relay (L1)

The atom machine has a grey relay: every inference's `invoke X` points only at its tool `X`.
**L1 collapses that relay** — relabel each state by stripping the `invoke ` prefix, so
`invoke read source code` and `read source code` become one state. The edge construction is
identical; only the node label changes — strip the prefix on both endpoints of every L0 edge,
drop the resulting self-loops (the relay `invoke X → X` becomes `X → X` and vanishes), and
re-aggregate. This removes ~half the states and leaves pure act→act flow (`plan → read`,
`read → edit`, …).

```sql
WITH atoms AS (SELECT id, sequence_in_node AS pos, action AS atom FROM semantics),
toolatom AS (SELECT a.id, a.atom FROM atoms a JOIN nodes n ON n.id=a.id WHERE n.type='tool'),
infentry AS (SELECT a.id, arg_min(a.atom,a.pos) atom FROM atoms a JOIN nodes n ON n.id=a.id WHERE n.type='llm_request' GROUP BY a.id),
r1 AS (SELECT 'invoke '||t.atom s, t.atom d FROM causal_edges e JOIN toolatom t ON t.id=e.to_id JOIN nodes n ON n.id=e.from_id AND n.type='llm_request'),
r2 AS (SELECT a1.atom s, a2.atom d FROM atoms a1 JOIN atoms a2 ON a1.id=a2.id AND a2.pos>a1.pos WHERE a1.atom NOT LIKE 'invoke %'),
r3 AS (SELECT t.atom s, ie.atom d FROM causal_edges e JOIN toolatom t ON t.id=e.from_id JOIN infentry ie ON ie.id=e.to_id),
l0 AS (SELECT s,d FROM r1 UNION ALL SELECT s,d FROM r2 UNION ALL SELECT s,d FROM r3),
merged AS (SELECT
  CASE WHEN s LIKE 'invoke %' THEN substr(s,8) ELSE s END s,   -- 'invoke ' = 7 chars
  CASE WHEN d LIKE 'invoke %' THEN substr(d,8) ELSE d END d
  FROM l0)
SELECT s, d, COUNT(*) w FROM merged WHERE s<>d GROUP BY s,d ORDER BY w DESC;
```

Cost is unaffected — it already lives on the inference, counted once; the merged state just
carries the same inference cost under the un-prefixed label. Render the same way (§5).

## 4 — Decorate

- **Cost per state** = sum over the **inferences** in that state (counted ONCE — never
  multiply across a fan-out's tools): visits, `SUM(tokens_out)`, `SUM(duration_ms)`. Cost
  lands on the reasoning step.
- **Edge weight** = `causal_edges` count for that `src→dst`.
- **Branch/outcome** = whether the bridging tool(s) errored (`is_error`); a back-edge to an
  earlier state on error is the recovery loop — the most insightful label. Pull the
  underlying `comment`s on hot/recovery edges to narrate _what_ happened.

## 5 — Render

Emit a `.dot` (one line per node, one per edge; weight as `penwidth`/label; tint heavy or
error edges), then:

```bash
dot -Tsvg graph.dot -o out/graph.svg     # SVG: vector + zoomable — the right format when dense
dot -Tpng -Gsize="34,34\!" graph.dot -o out/thumb.png   # capped PNG thumbnail (full PNG can be >50MB)
```

Generate the `.dot` straight from SQL (the query above) — pipe `duckdb <db> -noheader -list`
over the dumped `graph.db`, or the MCP `query`. Open the SVG and deliver.

## Guardrails

- **Never hardcode the vocabulary** — re-derive atoms from this DB every run.
- **`invoke X` has exactly one out-edge (`→ X`).** Co-occurring atoms in a node are not its
  successors. Assert out-degree 1 on every `invoke …` state.
- Cost is the INFERENCE's output tokens + tool-span wall-clock (excludes model thinking
  between calls — state it). Tokens overlap across states; don't sum to one total.
- Fan-out: one inference → 1–N parallel tools → one next inference. One transition per
  `A→B`; inference cost counted once. (~10% of coach inferences fan out, up to 8-wide.)
- `semantics` is **one row per act** (`action`), not an array; the stripped argument lives in
  `repo_path`/`package`/`url`; `action`/`repo_path` are NOT on `nodes` anymore.
- Shell labels are input-independent: **every shell call is bare `run`** (program stripped into
  `bash_command`/`comment`). A run step's intent is only as good as its `comment`; no comment →
  unknowable from the data (note it).
- Mermaid can't render past ~150 nodes (its browser renderer OOMs) — use Graphviz.
- coach has zero `hook` nodes — deterministic PostToolUse hooks are invisible; "no verify"
  means no AGENT-issued check, not "no gate ran".
