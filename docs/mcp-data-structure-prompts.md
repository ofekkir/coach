# Coach store + data-structure plan (server-first)

The app stops running the pipeline. Instead it queries a **node HTTP server** that runs the pipeline +
materialization and serves both the visualization view-model and an ad-hoc SQL surface over **DuckDB**.
The MCP keeps working — it's the same `Store`, exposed over a second transport. The browser/Service-
Worker path is **kept as a future drop-in**, not built now: as long as the pipeline (and the pure
`materializeSql` + schema specs) stay `no node:*`, "go in-browser later" is an additive change, not a
rewrite.

Why server-first: it deletes the two riskiest items (DuckDB-WASM backend, Service Worker + OPFS) and
replaces them with one boring one (an HTTP server over code that already exists). The data items then
dominate the work instead of the architecture.

Every item lists **Correctness verification** (automated, CI) and a **You verify** line (a manual check
you run). _Parallel_ waves can run concurrently — one git worktree per item, integrated in the stated
order.

---

## Target architecture (now, and the deferred option)

```
 BROWSER (app)                         NODE server (@coach/mcp or @coach/server)
 ┌───────────────┐  fetch('/api/…')   ┌─────────────────────────────────────────┐
 │ React app     │ ──────────────────▶│  HTTP routes:                           │
 │ data-source.ts│ ◀──────────────────│   /api/load  → runPipeline + materialize│
 └───────────────┘   JSON / VizData   │   /api/view  → buildVizResults (VizData) │
                                       │   /api/query · /api/subtree · /api/causal│
                                       │            │                            │
                                       │   ┌────────┴─────────┐   ┌────────────┐ │
                                       │   │ @coach/store     │   │ @coach/    │ │
                                       │   │ schema·materialize│  │ pipeline   │ │
                                       │   │ query core·Store  │  │ (no node:*)│ │
                                       │   └────────┬─────────┘   └────────────┘ │
                                       │     node-api Connection (DuckDB)        │
                                       └─────────────────────────────────────────┘

 DEFERRED (drop-in, not built now): a Service Worker answers the SAME /api/* locally via a
 duckdb-wasm Connection → restores in-browser execution + privacy by flipping the data-source base URL.
```

Invariants to protect **so the deferred path stays a drop-in**:

- `@coach/pipeline` stays `no node:*` (it runs server-side now, browser-side later).
- `materializeSql` + the `schema.ts` TABLES specs stay **pure / `no node:*`** too (only the _connection_
  is node-bound). This is the cheap insurance that keeps the WASM/SW option open. **Document why.**

---

## House rules (apply to every item)

> Branch + PR, never commit to `main`. `pnpm check` must pass (typecheck, ESLint `--max-warnings=0`,
> Prettier, Vitest, Knip, `check:structure`). Don't weaken configs, add `eslint-disable`, or introduce
> `any`. Tests co-located. Update `ARCHITECTURE.md` + the MCP `describe_schema` docs in the **same** PR
> as any data-model change. Adding a column to `TABLES` auto-flows through `materializeSql`; you still
> populate it in the record builder.

---

## Waves & concurrency at a glance

| Wave                        | Items                              | Runs                                  | Depends on        |
| --------------------------- | ---------------------------------- | ------------------------------------- | ----------------- |
| **0 — Foundation**          | 1, 2                               | serial (1 → 2)                        | —                 |
| **1 — Two parallel tracks** | **A:** 3 · **B:** 4, 5, 6, 7, 8, 9 | A ∥ B; inside B parallel\*            | 1 (and 3 needs 2) |
| **2 — Rollups**             | 10, 11                             | parallel (10 ∥ 11)                    | 7 + 5             |
| **Later / optional**        | 12, 13                             | when you want in-browser/privacy back | 1 (+ 3)           |

\* **Track B collision caveat:** items 4–9 all add columns to the same two files (`schema.ts` +
`materializeSql` record builders). Logically independent, physically colliding. Do each on its own
worktree, keep each item's column edits in a **non-overlapping block**, and merge one PR at a time
(rebase the next on the merged previous). Pipeline-side work (stages/types) rarely collides.

Track A and Track B touch disjoint files (transport vs. schema/pipeline) → safe to run fully concurrently.

---

# WAVE 0 — Foundation (serial)

## 1. Extract `@coach/store` core + node-api backend with engine read-only _(folds old #8 + #9)_

**Goal.** One reusable `Store` both the MCP stdio entry and the HTTP server sit on, with the database
itself enforcing read-only. Keep `materializeSql` + `schema.ts` pure.

**Key files.** New `@coach/store` (holds `schema.ts`, `materializeSql`, the query core extracted from
`store.ts`, and the `Store`/`Connection` interface). `packages/mcp/src/store.ts` → a node-api
`Connection`.

**Guidelines.**

- `Store` (query/subtree/causalPath, caps, JSON-safe shaping) is transport- and backend-neutral; the
  `Connection` port has the minimal `run`/`query` primitives.
- **Engine read-only (old #8):** materialize into a **temp file-backed** DuckDB (writable), serve
  queries through a read-only handle (`access_mode=READ_ONLY` or `ATTACH … (READ_ONLY)`), with
  `enable_external_access=false` + `lock_configuration=true`; clean up on `close()`. Keep only a
  **minimal UX check** (single statement, leading `SELECT`/`WITH`); **delete `FORBIDDEN_KEYWORD`**.
- **Byte budget (old #9):** result shaping truncates rows / clips long cells past a byte cap, sets
  `truncated=true` with a note — never throws, never spills.
- Keep `materializeSql` + `schema.ts` `no node:*` (preserves the deferred WASM path). Knip-enforce it.

**Correctness verification.**

- Existing `store.test.ts` / `tools.test.ts` pass against the node-api `Connection`.
- Read-only: queries with `'install'`/`'Write'`/`'rm -rf'` **inside string literals** now pass;
  `DELETE`/`DROP`/`UPDATE`/`INSERT`, `SELECT …; DROP …`, and the sandbox cases `COPY (SELECT 1) TO
'/tmp/x.csv'`, `INSTALL httpfs`, `ATTACH …` are all refused with no file written.
- Byte budget: an over-budget result returns `truncated=true`, under cap, no throw; small query returns
  full fidelity.

**You verify.** Load the fixtures via the MCP, re-run this session's queries (cost rollup, redundant
tools) → identical output. `query("COPY (SELECT 1) TO '/tmp/x.csv')")` refused, no file written.
`SELECT prompt FROM nodes` returns inline (no 151k-char spill).

**Success.** [ ] `@coach/store` exists; MCP rebuilt on it; `pnpm check` green. [ ] read-only +
byte-budget tests pass; `FORBIDDEN_KEYWORD` gone.

## 2. Node HTTP server over the `Store` (+ view endpoint)

**Goal.** The thing the app queries. Wrap the existing `Store` + `buildVizResults` in HTTP.

**Key files.** New HTTP entry in `@coach/mcp` (or a thin `@coach/server`); reuse `load.ts`'s pipeline
run.

**Guidelines.**

- Routes: `POST /api/load` (files → graph + DB + analysis), `GET /api/view` (the `VizData` the app
  renders, via `buildVizResults`), `POST /api/query`, `GET /api/subtree`, `GET /api/causal`.
- Responses are the same JSON shapes the MCP returns (`QueryResult`, `VizData`). Stateless per dataset
  or a simple in-process session keyed by an id — document which (single-user assumption is fine now).
- Read-only + caps come for free from the `Store`. CORS as needed for local dev.

**Correctness verification.**

- Integration test: `POST /api/load` (fixture) then `POST /api/query` returns expected rows; `GET
/api/view` returns a `VizData` that deep-equals `buildVizResults` on the same input.
- Error shape: a bad SQL / write attempt returns a clean 4xx, not a 500 stacktrace.

**You verify.** `curl` (or REST client) `/api/load` a fixture then `/api/query` `SELECT type, count(*)
FROM nodes GROUP BY 1` → same numbers as the MCP; `/api/view` returns renderable `VizData`.

**Success.** [ ] endpoints serve query + view; integration test green. [ ] `/api/view` matches
`buildVizResults`.

---

# WAVE 1 — Track A: App becomes a thin client (depends on 2)

## 3. Rewire `data-source.ts` to `fetch('/api/…')`

**Goal.** The app renders from the server; it no longer imports pipeline internals on the render path.

**Key files.** `packages/app/src/data-source.ts`, upload flow, viz data loading.

**Guidelines.** `processUploads` → `POST /api/load`; rendering reads `GET /api/view`; analysis features
read `/api/query`. The app depends only on `VizResult`/`VizData` + the HTTP shapes. Put the server base
URL in one config constant — that single value is the future Service-Worker swap point.

**Correctness verification.**

- Imports/Knip: the `@coach/app` render path has **no** direct `@coach/pipeline` import (types only).
- E2E: upload native `.jsonl` + the OTEL set → graph renders, identical to pre-change.

**You verify.** Run the app, upload a fixture → graph renders from `/api/view`. DevTools → Network shows
`/api/*` calls. (When you later add the SW, this same panel should show them served locally.)

**Success.** [ ] app renders via `/api/*`; no pipeline internals imported in the render path. [ ] base
URL is a single swappable constant.

---

# WAVE 1 — Track B: Data structure (parallel\*, one worktree each — depends on 1)

## 4. Promote `file_path` + `bash_command` columns _(old #1)_

**Parallel with:** 5,6,7,8,9.
**Goal.** Kill repeated `json_extract_string(tool_input,'$.file_path' / '$.command')`.
**Guidelines.** Add `file_path VARCHAR`, `bash_command VARCHAR` to `nodes`; derive on the canonical tool
node in `@coach/pipeline` if possible, else parse in the store layer; one tested extractor.
**Correctness verification.** Extractor unit test (Read→path, Bash→command, malformed→both NULL, no
throw). Invariant: `WHERE name='Bash' AND bash_command IS NULL` = 0; same for file tools + `file_path`.
**You verify.** `SELECT name, file_path, bash_command FROM nodes WHERE type='tool' LIMIT 5` — both populated.
**Success.** [ ] check green + extractor test; [ ] invariants return 0.

## 5. Integer `seq` + numeric time columns _(old #4)_

**Parallel with:** 4,6,7,8,9. **Unblocks:** 10, 11.
**Goal.** Correct, fast ordering without sorting a VARCHAR ns string.
**Guidelines.** `seq INTEGER` (0-based within interaction; tiebreak start→end→id) + `start_time`/
`end_time` `BIGINT`; keep the VARCHAR ns columns.
**Correctness verification.** Per interaction `seq` dense `0..n-1` (no gaps/dupes); `ORDER BY seq` ==
`ORDER BY start_time_ns` on a fixture.
**You verify.** `SELECT interaction_id, min(seq), max(seq), count(*) FROM nodes GROUP BY 1 LIMIT 5` →
`min=0`, `max=count-1`.
**Success.** [ ] ordering tests green; [ ] manual invariant holds.

## 6. `worktree`/`branch` dimension + normalized `repo_path` _(old #5)_

**Parallel with:** 4,5,7,8,9.
**Goal.** Cross-worktree aggregation as a `GROUP BY`, not a path regex.
**Guidelines.** `sessions.cwd` + `sessions.branch`; `nodes.repo_path` (repo-relative, worktree segment
stripped), derived from session `cwd` (no hard-coded user prefix).
**Correctness verification.** Same file under two worktree cwds → one identical `repo_path`; path with
no repo root unchanged (no crash); `repo_path` never contains `/.claude/worktrees/` or a leading `/`.
**You verify.** `SELECT repo_path, count(DISTINCT session_id) … GROUP BY 1 ORDER BY 2 DESC LIMIT 10`
collapses a file across worktrees into one row; `SELECT branch, count(*) FROM sessions GROUP BY 1`.
**Success.** [ ] normalization test green; [ ] manual collapse confirmed.

## 7. Canonical `action` taxonomy column _(old #2)_

**Parallel with:** 4,5,6,8,9. **Unblocks:** 10, 11.
**Goal.** Replace ad-hoc CASE/regex tool classification with one promoted enum.
**Guidelines.** Closed enum in `@coach/semantics` (`explore|author|edit|run|test|verify|vcs|setup|mcp|
research|delegate|plan|other`); deterministic rule-based mapping from `(name, bash_command)` in the
stage-6 step; surface as `nodes.action`. Separate from free-form `semantics.what`.
**Correctness verification.** Mapping unit test covering every branch (`git push`→vcs, `pnpm test`→test,
`tsc`→verify, `mkdir`→setup, unmatched Bash→run). Invariant: no tool node NULL `action`; values ∈ enum.
Determinism: reload → identical counts.
**You verify.** `SELECT action, count(*) FROM nodes WHERE type='tool' GROUP BY 1 ORDER BY 2 DESC` — no
NULL row; edit/explore/run dominate (matches this session's distribution).
**Success.** [ ] mapping test green; [ ] no-NULL invariant; [ ] determinism check.

## 8. Capture tool results / errors _(old #3 — biggest lift)_

**Parallel with:** 4,5,6,7,9.
**Goal.** Record success/failure per tool call — unlocks the true "misleading file" signal.
**Guidelines.** In the canonical stage, match the harness `tool_result` by `tool_use_id` (native: next
user turn; OTEL: span/log). Add `is_error BOOLEAN`, `error_kind VARCHAR`
(`not_found|invalid_args|permission|timeout|nonzero_exit|other`, NULL if ok), `result_summary VARCHAR`
(≤500 chars). Rule-based `error_kind`, no LLM. Promote all three.
**Correctness verification.** Fixture with a real failing `Edit` ("String to replace not found") + a
success → assert `is_error`/`error_kind` for both. Report (don't drop) unmatched tool calls.
**You verify.** `SELECT name, error_kind, count(*) FROM nodes WHERE is_error GROUP BY 1,2 ORDER BY 3
DESC` non-empty on the full dataset; re-run "misleading file" as failed-edits-per-file → `place-members.ts`
surfaces.
**Success.** [ ] failing/success fixture test green; [ ] errors query non-empty; [ ] misleading-file
query now uses ground truth.

## 9. `cost_usd` is traced-only + interaction `intent_category` _(old #10)_

**Parallel with:** 4,5,6,7,8.
**Goal.** Honest cost (known-or-NULL, never estimated); intent as a column.
**Guidelines.** `cost_usd` is populated **iff the trace carries a cost**; otherwise it stays **NULL
("unknown"), never 0**. We deliberately do **not** back-compute it from a model price table — a
price-table figure is a guess (prices drift, ≠ what was charged) and would be indistinguishable from a
real cost once written. (Superseded the earlier "derive from `model + tokens`" plan — see the cost
note in ARCHITECTURE.md.) Add `interaction.intent_category` from a fixed closed enum via the existing
semantic labeler.
**Correctness verification.** Invariant: every native (untraced) `llm_request` row has NULL `cost_usd`;
a traced cost flows through verbatim. Intent: 100% non-NULL coverage + a human-picked ~15-prompt gold
set the labeler must match ≥80%, documented in the PR.
**You verify.** `SELECT count(*) … WHERE type='llm_request' AND cost_usd IS NOT NULL` is **0 for native
sessions** (NULL, not 0); `SELECT intent_category, count(*) … GROUP BY 1` matches your gold set.
**Success.** [ ] traced-only invariant green; [ ] intent coverage; [ ] gold-set met.

---

# WAVE 2 — Rollups (parallel: 10 ∥ 11; depends on 7 + 5)

## 10. `interaction_metrics` rollup VIEW _(old #6)_

**Goal.** Flatten repeated per-interaction aggregations.
**Guidelines.** A DuckDB **VIEW** (not a materialized table — in a columnar engine a stored copy of an
aggregate only risks drift): `interaction_id, session_id, sequence, prompt_len, tool_count, llm_count,
tokens_in, tokens_out, cost_usd, duration_ms, shape, first_action, last_action, distinct_files,
error_count`, all GROUP BY over `nodes`. Lives in `db/views.ts`; `materializeSql` emits `CREATE VIEW`.
**Correctness verification.** Because it is a view, equality with `nodes` holds **by construction**; the
SQL is proven valid + agreeing with a direct node aggregate against real DuckDB in `mcp/duckdb.test.ts`.
`shape='agentic'` iff `tool_count>0`.
**You verify.** `SELECT shape, count(*), round(avg(tool_count),1) FROM interaction_metrics GROUP BY 1`;
row count == number of interaction nodes; cost rollup is one line off this view.
**Success.** [ ] view valid + agrees with raw aggregate (DuckDB); [ ] row-count + shape checks.

## 11. `transitions` VIEW (action → next action) _(old #7)_

**Goal.** Make "common workflow" a sort, not a hand-written `LEAD` self-join each time.
**Guidelines.** A DuckDB **VIEW** (`db/views.ts`): a `ROW_NUMBER() OVER (PARTITION BY interaction_id
ORDER BY seq)` window over TOOL nodes, self-joined rank *n*→*n+1*, one row per adjacent pair
(`interaction_id, from_seq, from_action, to_action`).
**Correctness verification.** Rows per interaction = `tool_count − 1`, never negative — asserted against
real DuckDB in `mcp/duckdb.test.ts` (total `transitions` rows == Σ `tool_count − 1` from
`interaction_metrics`).
**You verify.** `SELECT from_action, to_action, count(*) n FROM transitions WHERE from_action<>to_action
GROUP BY 1,2 ORDER BY n DESC LIMIT 5` reproduces `explore→edit`, `edit→explore`, `edit→verify`.
**Success.** [ ] view valid + `tool_count − 1` invariant green (DuckDB); [ ] dominant edges reproduced.

---

# LATER / OPTIONAL — restore in-browser execution + privacy (drop-in)

Build these only when you want trace data to stay on-device (or offline use). Because items 1–3 kept the
`fetch('/api/…')` seam and `materializeSql`/schema/pipeline stayed `no node:*`, this is additive.

## 12. DuckDB-WASM `Connection` backend

**Depends on:** 1.
**Goal.** A browser `Connection` on the same `Store`, consuming the same pure `materializeSql`.
**Correctness verification.** Parity test: the same fixture graph in the node-api and wasm backends
returns **identical rows** for a query battery (counts, cost rollup, redundant tools).
**You verify.** In a scratch page, `SELECT type, count(*) FROM nodes GROUP BY 1` matches the server.
**Success.** [ ] parity test green; [ ] app still builds to a static bundle.

## 13. Service Worker answering `/api/*` locally (+ OPFS)

**Depends on:** 12, 3.
**Goal.** Flip the data-source base URL to a SW that serves `/api/*` via DuckDB-WASM — same app code.
**Guidelines.** SW `fetch` handler routes `/api/*` to the wasm `Store`; **persist the DB to OPFS** (or
rebuild from upload files cached in IndexedDB) so an idle/killed SW reattaches — the in-memory DB must
never be the only copy.
**Correctness verification.** Integration: `/api/load` then `/api/query` returns expected rows.
**SW-restart test:** kill the SW, hit `/api/query` again — still answers (OPFS reattach), not a cold DB.
**You verify.** Upload a fixture; DevTools → Application → Service Workers → **Stop**, then query — still
works; Network shows `/api/*` served locally and **no external request carries trace data** (privacy as
an observable fact).
**Success.** [ ] `/api/*` answered locally; SW-restart test passes. [ ] base-URL flip is the only app change.

---

## Suggested execution

- **Now (serial):** 1 → 2.
- **Then two tracks in parallel:** **A:** 3 (thin-client rewire). **B:** spin 4–9 as separate worktrees;
  **start 7 (action) and 8 (errors) first** — 7 unblocks Wave 2, 8 is the long pole — integrating Track
  B PRs one at a time to tame the schema/materialize collision.
- **Then:** 10 ∥ 11 once 7 + 5 are merged.
- **Whenever privacy/offline matters:** 12 → 13. No app or pipeline rewrite — that's the payoff of
  keeping `no node:*` and the `fetch` seam.
