> **Living document** — update this file in the same change whenever package layout,
> module boundaries, or data flow change. Keep it honest on structural changes; consult
> it before architectural tasks.

# Coach — Architecture

## Overview

Coach processes agent execution traces and renders them as an interactive causal graph.
The core thesis: harness-agnostic OTEL traces feed a pure data pipeline whose output can
be reflected back to the agent (or its engineer) for improvement.

The system is split into five packages plus a Node CLI layer:

```
┌─────────────────────────────────────────────────────────┐
│  @coach/app  (packages/app)                             │
│  React SPA · Graph renderer                             │
│                                                         │
│  ?data=<url> / file → data-source.ts → viz/App          │
│  (renders a pre-computed ExecutionGraph)                │
│                               │                         │
│           ┌───────────────────┘                         │
│           ▼                                             │
│  @coach/pipeline (packages/pipeline)                    │
│  Pure data processing · No node:* imports               │
│  classify → route → canonical → aggregate →             │
│            execution graph  (run offline by the CLI/MCP)│
└─────────────────────────────────────────────────────────┘

scripts/          Node CLI — reads from disk, writes JSON artifacts
                  depends on @coach/logger for structured output

@coach/logger (packages/logger)   shared pino logger; transport/stream
                                  is the single seam for OTEL/Coralogix/Datadog
```

## Package layout

| Package / dir        | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/logger`    | Shared pino logger; the transport/stream is the single seam for sending logs to OTEL/Coralogix/Datadog later.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `packages/pipeline`  | Pure staged pipeline: classify → route → canonical → aggregate → execution graph → analysis, plus orchestration, plus the graph→DB SQL (`db/`: the relational schema specs + `materializeSql`). Organizes data losslessly; carries no presentation. Zero `node:*` imports — runs in browser and Node alike.                                                                                                                                                                                                                                 |
| `packages/app`       | React SPA: renders a pre-computed `ExecutionGraph` (loaded from a file or fetched via `?data=<url>`); graph visualization + data-source seam. Does not run the pipeline in the browser.                                                                                                                                                                                                                                                                                                                                                     |
| `packages/mcp`       | MCP server over the stage-6 graph. Owns the backend-neutral query core (`query-core.ts` + `guard.ts`/`result.ts`: read-only UX guard, capped JSON-safe results, graph traversal) over a `Connection` port, plus the node-api `Connection` (`duckdb.ts`) that runs `@coach/pipeline`'s `materializeSql` into a temp file-backed DuckDB and serves it through a READ_ONLY handle. Exposes read-only SQL + graph-traversal tools so an analyst agent drives its own analyses. Node-only (filesystem + native DuckDB). See "MCP query surface". |
| `packages/semantics` | Semantics config as a pure package: Zod schemas + `assembleSemanticsConfig` + the bundled JSON artifacts (`src/data/ontology`, `agents`) + `defaultSemanticsConfig`. JSON is imported (bundled), never read from disk. See its README.                                                                                                                                                                                                                                                                                                      |
| `scripts/`           | Node CLI over the same pipeline. Reads fixture files from disk, writes `out/*.json` artifacts. Uses `@coach/logger` for structured log output.                                                                                                                                                                                                                                                                                                                                                                                              |

## Data flow

`packages/pipeline/src/orchestrate.ts` exposes `runPipeline(files, config?): PipelineResult` — seven
named stages, each surfaced as a member: `classified`, `sessions`, `canonicalBySession`,
`agentGraph`, `executionGraph`, `enrichedGraph`, `analysis`. It is pure and file-system-free; the CLI
and the app both call it. Stage 6 enrichment is deterministic and always runs (using `config`,
defaulting to the bundled `defaultSemanticsConfig`). Stage 7 analyzes the enriched graph alone.
`buildVizResultFromExecutionGraph` is a thin adapter that wraps a pre-computed execution graph in the
`VizResult` shape the renderer consumes (used by the app's pipeline-output loader).

The pipeline **organizes** data; it does not decide how to render it. The execution graph is a
**normalized, stage-layered, id-keyed model** that maps 1:1 to a relational DB, so persistence is a
later drop-in with no reshaping. Three concerns are kept strictly separate:

- **Node data is additive per stage, keyed by a shared node id.** Three id-keyed tables hang off the
  `ExecutionGraph`: `nodes` (stage 3 canonical data — the value type is `CanonicalNode`), `deltas`
  (stage 5 — per-`llm_request` `requestMessagesDelta` / `responseMessagesDelta`, the messages new to
  that step vs. the previous request in the same thread), `semantics` (stage 6 — per-node `what`
  plus an optional `comment`), `actions` (stage 6 — one **closed `action`** per tool node), and
  `intents` (stage 6 — one **closed `intent_category`** per interaction node, derived from the
  prompt; the interaction-level analogue of `action`).
  `node.id == data.id` across every layer (1:1 joins). A node "points
  to" its data **by id, resolved through a table** (`nodeData` / `deltasOf` / `semanticsOf` /
  `resolve`) — never an embedded object, so nothing re-duplicates on serialize/DB. There is **no
  `action`/`inference` node type**: "is this node enriched?" is answered by "does a `semantics[id]`
  row exist".
- **`action` is a closed activity dimension, distinct from the free-form `semantics.what`.** `what`
  is rich, ordered, open-ended human-readable phrasing; `action` is a single value from a small fixed
  enum (`explore|author|edit|run|test|verify|vcs|setup|mcp|research|delegate|plan|other`, defined in
  `@coach/semantics`) so the store can `GROUP BY action` for stable, comparable counts. It is derived
  deterministically by `classifyAction(name, bashCommand?)` (no LLM, no config) in stage 6 for
  **every** tool node — never NULL — and surfaces as the non-NULL `nodes.action` column. The Bash
  command and file path are promoted to their own `nodes` columns — `bash_command` (from
  `tool_input.command`) and `file_path` (from `tool_input.file_path`/`notebook_path`) — by a single
  total extractor (`extractBashCommand` / `extractFilePath` in `graph/semantic/derive.ts`) reused by
  both the materializer and `classifyAction`, so there is one source of truth for the command. Both
  are NULL for tools that don't carry them and on malformed input (the extractor never throws);
  invariant: every `name='Bash'` node has a non-NULL `bash_command`, and every Read node a `file_path`.
- **Edges are two different relations over the same nodes.** _Containment_ ("child is contained in
  time by parent") is the `parent` self-FK, surfaced per interaction as `tree` (an id-only
  `ExecutionNode` = `{ id, children }`). _Causal_ ("effect triggered by cause") is its own DAG edge
  set (`causalEdges`), introduced in stage 5 and reused unchanged by stage 6.
- **Scope FKs are denormalized onto every node so aggregation is a flat filter, not a parent-walk.**
  `sessionId` is stamped at construction (stage 3, a constant for the pass); `interactionId` (the
  `parent`-closure root — its own id for an interaction node) needs the closure, so it is stamped in
  stage 4 (`aggregate`). Per-interaction analysis filters `nodes` by `interactionId` instead of
  walking the containment `tree`.
- **Agent and session are ENTITIES, not nodes** — dimension rows referenced by FK (`sessionId`
  denormalized onto every node; `agentId` on each session). They never appear in the node table.

Carrying no embedded copies, no classes and no cycles, the whole `ExecutionGraph` is plain
JSON-serializable data that round-trips through `JSON.stringify`/`parse`. Each in-memory structure
maps to one table: `agents`, `sessions`, `nodes(parent self-FK, session_id FK, interaction_id FK)`, `node_deltas(1:1)`,
`node_semantics(1:1)`, `causal_edges(from_id, to_id, gap_ms)`. Presentation/label formatting lives in
the app, which derives all display text from the structured graph data.

```
Input files (accumulating — user stages N files/folders before submitting)
  *.jsonl                           native Claude Code session logs
  <dir>/logs.json + trace*.json     OTEL Tempo traces + structured log entries
        │
        ▼  Stage 1 — classify/classify.ts        → classified: ClassifiedInput[]
   classifyInputs()     each file tagged: otel-trace | otel-log | native | unsupported
        │
        ▼  Stage 2 — route/route.ts              → sessions: SessionInputs[]
   routeToSessions()    group supported inputs by session id:
                          otel-trace → span attr `session.id`
                          native     → jsonl `sessionId`
                          otel-log   → `session_id`, else the traces in its directory
        │
        ▼  Stage 3 — canonical/canonical.ts      → canonicalBySession[]
   toCanonical(session) per session, independent:
     otel:   join traces → enrichTrace(logs) → transformTrace   (one unified OTLP pass)
     native: nativeSessionToTrace → transformTrace              (OTLP round-trip, behind facade)
     both:   transformTrace stamps each node's sessionId FK (no session NODE is added)
        │
        ▼  Stage 4 — aggregate/aggregate.ts      → agentGraph: AgentGraph
   aggregate()          merge all sessions → one `nodes` table (dedupe by id) plus the
                          owning ENTITIES synthesized from the interaction nodes: one
                          `agent` and one `session` per harness session. Entities are
                          dimension rows (FK targets), NOT nodes (multi-agent is out of
                          scope — every session rolls up under one agent). Also stamps
                          the `interactionId` FK on every node (the parent-closure
                          root) so per-interaction aggregation is a flat filter.
        │
        ▼  Stage 5 — graph/execution/execution.ts  → executionGraph: ExecutionGraph
   buildExecutionGraph()  the mechanical, layered skeleton from the trace, no
                            interpretation. Entities own the structure (agent ▸ sessions
                            ▸ interactions); the node-graph lives in each interaction as
                            an id-only containment `tree`, `threads` (layout grouping),
                            and `causalEdges`. The `nodes` table is carried at the graph
                            level. There is NO prompt node — the interaction's input is
                            `InteractionNode.prompt`, and the renderer derives the
                            spine-head anchor from it (the first inference is a causal
                            root). Message deltas are emitted into the
                            graph-level `deltas` table keyed by id — for each
                            `llm_request`, the messages new to that step vs. the previous
                            request in the same thread.
                            threads/members are a LAYOUT grouping only — there is no
                            time-ordering edge layer (adjacency ≠ causality). The sole
                            edge layer is the causal flow (graph/execution/causal.ts,
                            InteractionExecution.causalEdges): a complete spine where
                            every step links to its cause — the first inference is a
                            root, fan-out inference → tool, fan-in tool → inference, inference
                            → inference continuation, a tool's overlapping sub-spans as
                            parallel children (tool → wait, tool → execution), and
                            tool hooks woven in (inference → PreToolUse → tool →
                            PostToolUse → inference). Tool links use tool_use_id
                            correlation (never timing); hooks pair to tools by name +
                            temporal adjacency (they carry no id). One recursive walk
                            over time-ordered sibling groups; children walked as a
                            sub-group headed by the parent. Signed gapMs per edge
                            (fan-out negative under streamed dispatch). Harness-
                            agnostic: native stamps tool_use_id on its tool spans,
                            OTEL gets it via enrich (from the tool decision log).
        │
        ▼  Stage 5.5 — graph/result/result.ts  → ExecutionGraph (+ unmatchedToolIds)
   matchToolResults(graph)  a PURE TABLE PASS that matches every `tool` node to its
                            result. A tool call's result is NOT on the tool node — it
                            arrives as a `tool_result` block, keyed by `tool_use_id`, in
                            the request messages (stage-5 `requestMessagesDelta`) of the
                            inference that consumed it. This indexes those blocks by
                            tool_use_id and annotates each matched tool node with three
                            promoted columns: `is_error` (the harness failure flag),
                            `error_kind` (a deterministic class, NO LLM — see below), and
                            `result_summary` (≤500-char cleanly-truncated result/error
                            text). Tool calls with NO matching result are REPORTED (their
                            ids returned in `unmatchedToolIds` → surfaced in analysis
                            `gaps`), never silently dropped; their `is_error` stays NULL.
                            error_kind rules, matched in priority order against the lower-
                            cased text: a failed-match edit (`no match` / `string to
                            replace` / `not unique`) → invalid_args (it is a bad
                            old_string, not a missing file); file/command not found
                            (`no such file` / `enoent` / `command not found` / `does not
                            exist`) → not_found; `permission denied` / `eacces` →
                            permission; `timed out` / `etimedout` → timeout; other
                            invalid-argument/parse text → invalid_args; a Bash `exit code
                            N>0` / `killed` → nonzero_exit; anything else → other.
        │
        ▼  Stage 6 — graph/semantic/semantic.ts  → ExecutionGraph (enriched)
   enrichExecutionGraph(graph, config)  a PURE TABLE PASS: iterates the `nodes`
                            table and, for each `tool` / `llm_request`, writes a
                            `semantics[id]` row (`what` + optional `comment`). No tree
                            walk — a node's label depends only on its own data and its
                            stage-5 deltas (read by id). tool-intent.ts + derive.ts label
                            each node deterministically (tool intent, path conventions,
                            thinking→plan, tool_use→invoke, session-title,
                            suggestion-mode) by interpreting the injected SemanticsConfig
                            — no hardcoded tool tables, no model. A genuine terminal
                            assistant message is labeled with the generic `respond`
                            act.
        │
        ▼  Stage 7 — graph/analysis/analysis.ts  → analysis: GraphAnalysis
   analyzeGraph(graph)      mechanical analysis of the ENRICHED graph and
                            NOTHING ELSE — per interaction: shape (query/agentic),
                            cost/token/latency rollup, longest step, critical path
                            (slowest route through causalEdges), redundant tool
                            calls, and `failureIds` (tool nodes whose matched
                            result carried is_error=true, from stage 5.5); rolled up
                            per session and agent. Per session it also emits
                            `misleadingFiles` — the "misleading file" signal, rebased
                            on failed edits: Edit/Write tool nodes with is_error=true
                            grouped by file_path, descending (a file that keeps
                            rejecting edits is one the agent's mental model of is
                            wrong). A function of the
                            `ExecutionGraph` alone, so the live pipeline, the MCP
                            reading a persisted graph, and the app's pre-computed-
                            load path share one derivation. `longestStep` and the
                            critical path moved here OUT of the app's
                            `viz/layout` pass — the moment a second, non-rendering
                            consumer exists, this derivation can't live in the
                            renderer. Observations that aren't yet mechanical (retry
                            vs. benign re-read) plus any unmatched tool calls (from
                            stage 5.5) are surfaced in `gaps`, never dropped.
                            Always runs as the final stage of runPipeline.
        │
        ▼  buildVizResultFromExecutionGraph() adapter → VizResult  (execution graph)
        ▼  packages/app/src/viz/App  (React Flow graph renderer)
```

`agentGraph` is the stage-4 `AgentGraph` — the `nodes` table plus the `agent`/`sessions` entity
tables. The execution graph is the deterministic, layered skeleton from the trace. `VizResult.data`
is the `ExecutionGraph` directly.

**Semantics config lives in `@coach/semantics`, injected into the pipeline.** Stage 6's
deterministic labels come from a `SemanticsConfig` — the typed form of two bundled artifacts under
`packages/semantics/src/data`: a domain **ontology** (`ontology/coding.json`, the closed
action/object vocabulary and source of truth, plus the universal command grammar and transferable
file/structure **conventions**) and per-agent **tool semantics** (`agents/claude-code.json`).
There is deliberately **no project layer** — path → object grounding is derived from the ontology's
generic conventions (file role + monorepo workspace qualifier), not per-repo directory maps, so any
coding project is grounded with zero per-project authoring. `assembleSemanticsConfig` validates both
and throws on any action/object id absent from the ontology (the referential-integrity contract);
`defaultSemanticsConfig` is the assembled coding × claude-code pair. The package is pure — the JSON is
**imported (bundled), never read from disk** — so the same assembled config serves the Node CLI and
the browser app. Enrichment is **fully deterministic**: `enrichExecutionGraph(graph, config)` derives
every label from config, with no model in the loop. A genuine terminal assistant message gets the
generic `respond` act; a weak-model labeler that classified that act more finely (from
`ontology.messageActs`) was removed for now — the vocabulary stays in the ontology, reserved for
reintroducing it. The interpreter (`graph/semantic`) is agent-agnostic, so a different domain/agent is
a config swap, not a code change. See `packages/semantics/README.md` for the resolution order and
what is deliberately out of scope (composition/inference roll-up). Enrichment writes into the
`semantics` table (one row per relabeled node), the `actions` table (one closed `action` per tool
node, derived by `classifyAction`), and the `intents` table (one closed `intent_category` per
interaction node, derived from the prompt by `classifyIntent`), and leaves the `nodes`/`deltas`/edges
untouched — the old copied twin types (`ActionNode`/`InferenceNode`) are retired.

**Cost derivation lives beside the vocabulary in `@coach/semantics`.** A bundled
`data/pricing/model-prices.json` (per-MTok USD, input/output, with a dated source comment) plus a
pure `costUsd(model, tokensIn, tokensOut)` deriver let the canonical builder fill `nodes.cost_usd`
when a trace carries no cost (the common native-log case): the OTEL/harness cost wins when present,
otherwise cost is derived from `model + tokens`. An **unknown model → NULL** (never 0) and is
surfaced through an optional `onUnknownCostModel` callback threaded from `runPipeline` — the pure
pipeline cannot import `@coach/logger` (it runs in the browser too), so the Node CLI (`scripts/e2e.ts`)
injects a logger-backed sink. `intent_category` is 100% non-NULL on interactions (fallback `other`).

All sessions roll up under one agent into a single execution graph, and sessions are navigated by
expand/collapse inside the graph. Unsupported files are carried through `classified` (never silently
dropped) and surfaced as a count. The graph is consumed only by the renderer — no raw
`CanonicalNode[]` reaches the visualization layer.

**Display derives from structure, never content.** Tree/thread nodes the layout walks are **id-only**
(`{ id, children }`); the layout resolves each id against the graph tables through one seam
(`layout/place-members.ts :: cardOf` / `nodeOf`, backed by `graph.nodes` + the `semantics` overlay,
threaded via `Ctx.graph`). `viz/format/format.ts :: buildNodeCard` takes a **`ResolvedNode`** (the
canonical row + its optional semantic fields) and returns a typed `NodeCard` — a curated, at-a-glance
summary (display type, title, structural key/values, numeric metrics). Entities render as container
cards from `buildAgentCard` / `buildSessionCard` (the degraded-graph synthesizer in `layout/queries.ts`
produces synthetic `Agent`/`Session` **entities**), never from the node table. The card reads only
fields the canonical model guarantees; it never interprets harness-shaped content (response content
blocks, `tool_input` JSON). That content flows untouched into a generic JSON tree (`viz/JsonView`,
backed by `@uiw/react-json-view`) in the details panel. Node data is **not** copied onto every React
Flow node: on selection, `App.tsx` resolves the one selected id (`resolve(graph, id)`) and passes the
node + deltas + semantics to `DetailsPanel`. Net effect: new node types or content shapes from the
pipeline render in the viewer for free; only the curated card touches `format.ts`.

**Structure encodes role; color is reserved.** The renderer is a warm, low-saturation system
(`viz/theme.ts` — the single token/glyph source, replacing the old per-type color maps). A node's
type is carried by a CSS **glyph** (hollow = inference, filled = action, solid fills = levels), not
a hue: levels render as **banners**, the user prompt as an **accent anchor**, everything else as a
**step card** (`TraceNode/levels.tsx`, `step.tsx`). The prompt anchor is **not a node** — it is
synthesized in the layout from `InteractionNode.prompt` (`buildPromptCard`), the way agent/session
cards are synthesized from entities; selecting it resolves to no node row, and its full text rides on
the card for the details panel. The lone clay accent is spent only on focus — selection, the prompt
anchor, and the **longest step** (its share-of-run bar + the edge into it), derived app-side in the
layout pass (`layout/place-graph.ts`). The main thread rides a spine;
off-spine threads (`source !== 'repl_main_thread'`) move to a dimmed background lane, a tool's raw
sub-spans (`tool.execution` / `tool.blocked_on_user`) are collapsed (only its one nested weak-model
inference surfaces, indented), and the top bar (`viz/TopBar`) shows the breadcrumb + run aggregates.
When the run is a DAG, the spine branches: `layout/parallel.ts` detects fork→branches→join groups
from `causalEdges`, `layout/parallel-place.ts` lays each as a centered row inside a faint
`PARALLEL LEVEL · ×N` band, and the slowest branch — the critical path — is the only one in accent.
Long values (a pasted prompt, a tool instruction) clamp on the card and open in full in the details
panel; the raw `canonical` node stays one click away in the JSON viewer.

## MCP query surface

Stage 7 (`analyzeGraph`) is a **curated, hardcoded** read of the graph — a fixed set of findings.
`@coach/mcp` is the **flexible** counterpart: it exposes the same stage-6 `ExecutionGraph` as a
queryable relational surface so an analyst agent composes its own analyses instead of being limited to
the canned ones. This is the deliberate payoff of the normalized, id-keyed model — the graph "maps 1:1
to a relational DB" (see the node-data/edge tables above), so making it queryable is a faithful load,
not a reshape.

- **Graph → DB SQL — `@coach/pipeline/db` (pure).** `materializeSql` turns the graph into
  ordered `CREATE`/`INSERT` statements driven entirely by the table specs in `db/schema.ts` (the single
  source of truth for both the DDL **and** the `describe_schema` tool, so they cannot drift). Tables
  mirror the model: the three id-keyed node-data layers (`nodes` / `deltas` / `semantics`), the two
  edge relations (`containment` / `causal_edges`), `threads` (layout lanes), and the `agents` /
  `sessions` dimension entities. The `nodes` table promotes common + type-specific columns and keeps
  the full raw node in a `data` JSON column (the escape hatch for un-promoted fields). Span timing is
  exposed twice: the VARCHAR `start_time_ns`/`end_time_ns` are retained as the full-precision int64
  nanosecond values (they overflow DOUBLE/JS `number`), alongside numeric `start_time`/`end_time`
  **BIGINT** columns (the same digits emitted as bare integer literals — never round-tripped through a
  JS number) for arithmetic and ordering. A dense `seq` INTEGER ranks every node within its owning
  interaction by `start_time_ns` ascending (`0..n-1`, no gaps): `ORDER BY seq` == `ORDER BY
start_time_ns`, a stable per-interaction timeline index. The `sessions` dimension carries `cwd` and
  `branch` (the working directory + git branch a session ran in; populated for native Claude
  sessions, NULL for OTEL traces, which expose neither). The `nodes` table adds a worktree-normalized
  `repo_path` (`db/repo-path.ts`): the file path a tool touched, derived from `tool_input`, collapsed
  to a single repo-relative form so the SAME file accessed under two different git worktrees yields ONE
  `repo_path`. The rule strips any `…/.claude/worktrees/<id>/<rest>` (or bare `worktrees/<id>/`) segment
  to `<rest>`, else makes the path relative to the session's (worktree-normalized) `cwd`; the result
  never contains `/.claude/worktrees/` and never has a leading `/`. No hard-coded prefix. This lives in
  the pipeline because the graph→DB mapping is pure (no `node:*`): the pipeline owns it, the MCP runs it.
  Beside those base tables sits one **derived rollup**, `interaction_metrics` (`db/interaction-metrics.ts`):
  one row per interaction where **every value is a pure aggregate over that interaction's `nodes` rows**
  (`prompt_len`, `tool_count`/`llm_count`/`error_count`/`distinct_files`, summed `tokens_in`/`tokens_out`/`cost_usd`,
  `duration_ms`, seq-ordered `first_action`/`last_action`, and `shape` = `'agentic'` iff `tool_count>0` else
  `'direct'`). It is a flat lookup for the common per-turn aggregates, never a new source of truth — an
  equality invariant (`db/interaction-metrics.test.ts`) recomputes each metric from `nodes` and asserts it matches.
- **Query core — `@coach/mcp` (pure, backend-neutral).** Beside the engine, the MCP holds the analyst
  `Store` (`query-core.ts`): a UX guard (`guard.ts`) + capped, JSON-safe result shaping (`result.ts`) +
  traversal SQL over a `Connection` port — no `node:*` or DB driver, so the same core could later serve
  a browser/WASM backend unchanged.
- **Engine — DuckDB (read-only boundary).** `@coach/mcp`'s `duckdb.ts` is the node-api layer, two ways
  in: `createDuckDbConnection(graph)` materializes the graph into a **temp** DuckDB (removed on close),
  and `openPersistedStore(dbPath)` opens a **pre-built coach DB file untouched** — no pipeline, no
  materialize. Either way queries run through a `READ_ONLY` handle with `enable_external_access=false`
  - `lock_configuration=true`. The **engine** is the read-only boundary — there is no keyword
    blocklist; the `Store`'s guard only rejects non-`SELECT`/multi-statement input for a friendly error.
    DuckDB was chosen over the workload scale (tiny) — for JSON columns, analytical SQL, and recursive
    CTEs.
- **Shippable DB artifact (`coach-build-db`).** `writePersistedDb(graph, dbPath)` materializes a stage-6
  graph into a self-contained, queryable `.db` that **also carries the enriched graph** in a
  `_coach_meta` table — so a loader recovers it for the graph-shaped tools (`resolve` / `get_analysis`)
  and the visualization without re-running anything. `coach-build-db <traces-dir> [out.db]` (root
  `pnpm build-db`) is the populate step: pipeline in, DB out. The browser can't read a `.db`, which is
  why the graph rides inside it — one artifact feeds both the MCP's SQL and the viz.
- **Tools (`tools.ts`).** Eight, bound to a session (its current dataset): `load_dataset` (point it at
  a directory — runs the pipeline and makes the graph queryable, replacing any prior dataset),
  `describe_schema` (tables + column docs + the semantic ontology vocabulary + example queries,
  including the stage-7 detectors written as SQL — works with nothing loaded), `query` (read-only single
  SELECT/WITH; enforced by the read-only engine, capped at ≤1000 rows **and** a serialized-byte budget
  with `truncated` flagging any cut), `resolve` (hydrate a node id across all
  three layers, reusing the pipeline's `resolve`), `subtree` and `causal_path` (traversal primitives
  over the containment tree / causal DAG, so the agent never hand-writes recursive CTEs), and
  `get_analysis` (the stage-7 `GraphAnalysis` verbatim, as one option among many — not the only way in),
  and `open_viz` (start a local static server over the built app + the stage JSON dumped into the cwd by
  the last directory load, and hand back a boot URL — `?data=<file>&focus=<nodeId>`).
  Tools carry a Zod input shape; the MCP layer validates args.
- **Stage dump + viz server (`dump.ts`, `viz-server.ts`, `bin/viz.ts`).** `dumpPipelineOutputs(result,
outDir)` writes the seven `01..07` stage JSON files + a self-contained `graph.db` for one pipeline run
  and returns the written paths; the `pnpm e2e` CLI and a **directory** `load_dataset` both call it (a
  directory load dumps into the cwd and reports the paths in its summary; a `.db` load does not — it's
  already a built artifact). `startVizServer` is a dependency-free `node:http` server that serves the
  built `@coach/app` (`packages/app/dist`, resolved relative to the package) plus those dumped JSON
  files, erroring with a build hint if `dist` is missing. `coach-viz [data-file] [focus]` (its bin) boots
  the server and opens the browser.
- **Session + loading (`session.ts`, `load.ts`, `server.ts`, `bin/mcp.ts`).** The server holds one
  mutable session: the dataset currently loaded. `load_dataset` takes either a **`.db`** (opened
  untouched via `openPersistedStore`, graph recovered from `_coach_meta`, analysis recomputed) or a
  **directory** of trace/native files (read into the same `UploadedFile[]` the browser produces, run
  through the pipeline, materialized). Either way it rebuilds the store (closing the previous one);
  data-bound tools read through `session.store()` / `session.dataset()`, which throw a clear "call
  load_dataset first" message until something is loaded. `coach-mcp [dir]`
  (root `pnpm mcp`) serves over stdio (`McpServer`) with an **optional** preload directory — omit it and
  the agent loads at runtime. Load-once / serve-many, one dataset at a time. Diagnostics go to **stderr
  only** — stdout is the JSON-RPC channel.

This is why stage 7 is "a function of the `ExecutionGraph` alone": the same derivation feeds the live
pipeline, the app, and now this MCP — and the MCP's flexible SQL surface sits beside it, not over it.

## Intake flow and the data-source seam

The app renders a **pre-computed** execution graph — it no longer runs the pipeline in the browser.
The graph is produced offline (the `pnpm e2e` CLI, or the MCP server) and reaches the renderer one
of two ways, both converging on a `VizResult` (`{ title, data: ExecutionGraph }`):

```
Boot params (src/main.tsx parses window.location.search)
  ?data=<url>  → fetch(url) → text → loadPipelineOutput(text, titleFromUrl(url))
                   └── <App data title> rendered directly (no upload page)
  ?focus=<id>  → passed to <App initialFocusId>; after first render a one-shot
                   effect calls App's onFocusId(id) — the same reveal/select/center
                   path the FocusInput search box uses (revealPath in layout/queries)
  (neither)    → <ManualRoot>: the upload page below

Manual intake: pre-computed pipeline output
  UploadPage.tsx  (PipelineOutputLoader)
    └── "Load pipeline output" → <input accept=".json"> single file
          └── data-source.ts :: loadPipelineOutput(jsonText, fileName)
                ├── extractExecutionGraph(raw)   ← detects bare ExecutionGraph
                │     or object wrapping one     ← or wrapper with executionGraph key
                └── @coach/pipeline :: buildVizResultFromExecutionGraph(graph, title)
                      └── VizResult  (file name without extension as title)
                            └── App.tsx renders the graph unchanged
```

**`packages/app/src/data-source.ts` is the single swap point** for changing where the
pre-computed graph comes from — it exposes `loadPipelineOutput` (parse + shape-detect + wrap).
The visualization layer depends only on `VizResult` / `ExecutionGraph`.

The shape-detection logic is centralized in `extractExecutionGraph`: it accepts a bare
`ExecutionGraph` (the e2e script's direct output) or any object with an `executionGraph` member,
tolerating the pipeline output format being reworked. `?data` fetch/parse failures render a readable
error screen rather than a blank page.

## Fixture modes

`pnpm e2e` accepts a path (relative to cwd) or a fixture name under
`packages/pipeline/fixtures/`. It calls `runPipeline` and dumps every stage member to
`out/<name>/`, so each stage is independently inspectable. (The earlier per-stage scripts —
`scripts/viz.ts`, `scripts/enrich.ts`, `scripts/etl.ts` — were removed; `e2e` covers the full
pipeline.)

| Member file                    | Stage | Contents                                                              |
| ------------------------------ | ----- | --------------------------------------------------------------------- |
| `01-classified.json`           | 1     | each file's name/path/type                                            |
| `02-sessions.json`             | 2     | session id, kind, and member filenames per session                    |
| `03-canonical-by-session.json` | 3     | `CanonicalNode[]` per session (each node carries its `sessionId` FK)  |
| `04-agent-graph.json`          | 4     | `AgentGraph` — the `nodes` table + `agent`/`sessions` entities        |
| `05-execution-graph.json`      | 5     | `ExecutionGraph` (id-keyed skeleton; `semantics` table empty)         |
| `06-enriched-graph.json`       | 6     | `ExecutionGraph` with the `semantics` table populated                 |
| `07-analysis.json`             | 7     | `GraphAnalysis` — mechanical analysis derived from the enriched graph |

Native `.jsonl`, single/multi-trace OTEL sets, and mixes of both in one gather all flow through
the same pipeline. The CLI populates `UploadedFile.path` relative to the gather root so the
session-id routing (with directory fallback for logs) groups them correctly.

## Deploying to Vercel (static SPA)

The app builds to static assets — no serverless functions.

```
Root directory:  packages/app
Build command:   pnpm --filter @coach/app build
Output dir:      packages/app/dist
Install command: pnpm install (at repo root)
```

See `vercel.json` for the committed configuration.
