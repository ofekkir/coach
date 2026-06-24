# Case study: coach, pointed at itself

> A worked example of the one claim coach is built to make — **the agent grades itself**. Everything
> here runs on the shipped surface (the pipeline → the DuckDB query tables → the MCP `query` tool);
> no roadmap capability is assumed. It doubles as a template for writing your own analyses, since
> coach deliberately ships **no curated-analysis stage** — every finding below is a SQL query over
> the [execution-graph tables](../ARCHITECTURE.md#mcp-query-surface), not a baked-in report.

## The setup

coach was built by dogfooding: its author pointed it at **his own ~148 Claude Code sessions** —
loaded by repo name, which folds the main checkout and every git worktree into one dataset (see
`resolve-dataset.ts` in [ARCHITECTURE.md](../ARCHITECTURE.md#mcp-query-surface)). The question was
the product's north star, asked of its own history: _which of my agent's mistakes are actually worth
fixing?_

The naive answer is "the most frequent ones." That answer is wrong, and seeing **why** it's wrong is
the whole point.

## The method: rank by preventable cost, not frequency

A failed tool call is not uniformly expensive. A `Read` that 404s and is retried once costs almost
nothing; a bad `Edit` that sends the agent into a multi-step re-read-and-retry loop costs thousands
of output tokens. So the ranking metric is:

```
cost of an error = frequency × per-error recovery cost
```

**Recovery cost** is measured with a **recovery-window model**, and this is where coach's normalized
schema earns its keep. Every node carries a dense, gap-free `seq` (its rank within the interaction by
start time — the materialized form of a `ROW_NUMBER()` window; see the `seq` column in
[ARCHITECTURE.md](../ARCHITECTURE.md#mcp-query-surface)). For each failed tool call, the recovery
window is:

> the failed tool node → the **next successful call of the same tool** in that interaction (by `seq`)

…and the cost is the `tokens_out` and wall-clock burned _in between_. Because `seq` is a total order
and `repo_path` collapses the same file across worktrees to one identity, "the next successful Edit
to the **same file**" is a clean self-join — the schema was shaped (id-keyed, denormalized scope FKs,
promoted `repo_path`/`error_kind` columns) precisely so this is one query, not a graph walk.

A sketch of the entry point — every failed tool call, coarsely bucketed, ranked by how often it
happens and what it touched:

```sql
-- The promoted columns do the work: is_error, error_kind, action, repo_path are all on `nodes`.
SELECT error_kind, action, count(*) AS errors
FROM tools
WHERE is_error
GROUP BY error_kind, action
ORDER BY errors DESC;
```

`error_kind` is intentionally coarse (`not_found | invalid_args | permission | timeout |
nonzero_exit | other`); finer distinctions ("string to replace not found" vs. "file modified since
read") come from matching `error_message` text. The recovery-window cost is the same shape with a
self-join on `seq` over `repo_path`, summing the `tokens_out` of the inferences in between.

## What it found

Across ~148 sessions: **~383 errors, ~292K output tokens and ~2.4 hours of recovery time.** Ranked
by _preventable_ cost, not raw count, the errors fall into four buckets:

| Rank | Bucket                         | Preventable cost                 | What it is                                                                                                                                      |
| ---- | ------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Read / snapshot discipline** | ~84K tok, 123 err, ~98% recovery | `Edit` against a stale or unread file — "string to replace not found", "file modified since read", `Read` 404. Almost always a pure waste loop. |
| 2    | **Bad Bash invocation**        | ~65K tok, 81 err                 | `invalid_args` (costliest _per error_ at ~1266 tok avg) and `not_found` commands.                                                               |
| 3    | **Git / PR / script workflow** | ~28K tok                         | failed pushes, PR plumbing, one-off scripts.                                                                                                    |
| 4    | **Rare high-cost**             | ~35K tok, 6 err                  | a rejected `ExitPlanMode` (~10K tok avg), a failed MCP `query` (~5K avg). Few, but brutal each.                                                 |

The **highest-ROI fix is a single deterministic harness change** — read/snapshot discipline — and a
frequency-only ranking would have buried it under noisier, cheaper errors. That inversion is the
finding.

## The two honest caveats — and why they're in the schema, not swept under it

A finding is only as trustworthy as what it admits it can't see. Two caveats shaped both the analysis
**and** the data model:

1. **`tokens_out` is an honest floor, not the full bill.** coach's native session logs capture
   `tokens_in` (only the _uncached_ fresh delta, ~77 tok/call) and `tokens_out` — but historically
   dropped the two large prompt-cache fields, so summing `tokens_in` undercounts real context by
   10–100×. coach **never back-computes a dollar figure from a price table** — a guessed cost is
   indistinguishable from a real one once written, so `cost_usd` stays **NULL ("unknown")** unless
   the trace itself carries it. `tokens_out` is the reliable proxy: output is complete in the logs,
   and since cache reads bill at ~0.1× while output bills at ~5× base input, output usually dominates
   the actual cost of a cached agent loop. So ranking by `tokens_out` is both an honest floor _and_ a
   decent marginal-dollar proxy. (The gap is now closed at ingestion: `cache_read_tokens` /
   `cache_write_tokens` are first-class, provider-neutral columns on `nodes` — see
   [ARCHITECTURE.md](../ARCHITECTURE.md#mcp-query-surface).)

2. **Not every red is an error.** ~75K tokens / ~98 of the failures were `Bash:nonzero_exit` from a
   test, typecheck, or lint coming back red, plus `grep` finding no match. That is the **intended
   verify loop**, not operational waste — lumping it into "fixable cost" would have inflated the
   numbers and pointed the fix in the wrong direction. The methodology excludes it explicitly. This
   is why `error_kind` separates `nonzero_exit` from the genuinely-wrong kinds.

## Why this is the proof, not a demo

This analysis is **not a feature** — there is no `get_analysis` tool, no findings stage. It is a
sequence of SQL queries an analyst agent composed against the relational surface coach exposes, and
`describe_schema` ships exactly these as example queries to extend. That is the deliberate payoff of
ending the pipeline at a normalized, id-keyed graph that "maps 1:1 to a relational DB": **analysis is
whatever query you write, not a frozen set of reports.** The same model that the React Flow app
renders is the model the agent queries.

The roadmap (see [README](../README.md#where-this-is-going)) is to close the loop — for the agent to
read this finding about _itself_ and correct its own read/snapshot discipline, rather than an
engineer reading it here. This case study is the engineer-facing half of that loop, working today.
