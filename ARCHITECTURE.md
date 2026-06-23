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

| Package / dir        | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/logger`    | Shared pino logger; the transport/stream is the single seam for sending logs to OTEL/Coralogix/Datadog later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/pipeline`  | Pure staged pipeline: classify → route → canonical → aggregate → execution graph → semantic enrichment, plus orchestration, plus the graph→DB SQL (`db/`: the relational schema specs + `materializeSql`). Ends at the enriched graph — curated analysis is queries, not a stage. Organizes data losslessly; carries no presentation. Zero `node:*` imports — runs in browser and Node alike.                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/app`       | React SPA: renders a pre-computed `ExecutionGraph` (loaded from a file or fetched via `?data=<url>`); graph visualization + data-source seam. Does not run the pipeline in the browser.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/mcp`       | MCP server over the stage-6 graph. Owns the backend-neutral query core (`query-core.ts` + `guard.ts`/`result.ts`: read-only UX guard, capped JSON-safe results, graph traversal) over a `Connection` port, plus the node-api `Connection` (`duckdb.ts`) that runs `@coach/pipeline`'s `materializeSql` into a temp file-backed DuckDB and serves it through a READ_ONLY handle. Exposes read-only SQL + graph-traversal tools so an analyst agent drives its own analyses. Node-only (filesystem + native DuckDB). The one **publishable** package: tsup bundles the pure workspace deps into a self-contained `coach-mcp` bin and ships the `analyze-traces` skill, so third parties install + run it without cloning. See "MCP query surface" → "Distribution". |
| `packages/semantics` | Semantics config as a pure package: Zod schemas + `assembleSemanticsConfig` + the bundled JSON artifacts (`src/data/ontology`, `agents`) + `defaultSemanticsConfig`. JSON is imported (bundled), never read from disk. See its README.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `scripts/`           | Node CLI over the same pipeline. Reads fixture files from disk, writes `out/*.json` artifacts. Uses `@coach/logger` for structured log output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Data flow

`packages/pipeline/src/orchestrate.ts` exposes `runPipeline(files, config?): PipelineResult` — six
named stages, each surfaced as a member: `classified`, `sessions`, `canonicalBySession`,
`agentGraph`, `executionGraph`, `enrichedGraph`. It is pure and file-system-free; the CLI
and the app both call it. Stage 6 enrichment is deterministic, always runs (using `config`,
defaulting to the bundled `defaultSemanticsConfig`), and is the final stage — curated analysis is
not a pipeline stage (every rollup is a query; see "MCP query surface").
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
  set (the ontology's `coarseActions`: `explore|author|edit|run|test|verify|vcs|setup|mcp|research|
delegate|plan|other`) so the store can `GROUP BY action` for stable, comparable counts. It is **not a
  second taxonomy** and it is **not hardcoded**: `action` is a COARSENING of the ontology's own ~30
  action ids, and the rollup lives in the ontology DATA — every action carries a `coarse` field, and
  `@coach/semantics`'s `action.ts` is pure resolver logic (`coarseAction`) that just reads it. The config
  layer resolves each tool call to one ontology action (`toolOntologyAction`); `coarseAction` rolls that
  up — one classification source of truth, no parallel TS table. The shell escape-hatch tools (Bash) are
  the one surface with no per-tool spec, so their command grammar (git→vcs, pytest→test, build→setup) is
  also DATA — the ontology's `commands` block — resolved by `shellCommandAction` into an ontology action,
  then rolled up the same way (so even Bash flows through the single rollup). The free-form
  `semantics.what` for a Bash node reuses that same grammar resolution (`escapeHatchPhrase` in
  `tool-intent.ts`): it renders the resolved action's label (`git commit`→"version control",
  `grep`→"search") rather than the literal "bash", qualifying the generic `run` fallback with the
  invoked program (`python3 build.py`→"run python3") so the phrase always names what ran.
  `assembleSemanticsConfig`
  enforces the integrity: every action's `coarse` is a declared `coarseActions` id and every command rule
  resolves to a real action, so the dimension cannot drift into unaggregatable values. Derived
  deterministically (no LLM) in stage 6 for **every** tool node — never NULL — and surfaces as the
  non-NULL `nodes.action` column. The Bash command and file path are promoted to their own `nodes`
  columns — `bash_command` (from `tool_input.command`) and `file_path` (from
  `tool_input.file_path`/`notebook_path`) — by a single total extractor (`extractBashCommand` /
  `extractFilePath` in `graph/semantic/derive.ts`) reused by both the materializer and the shell
  classifier, so
  there is one source of truth for the command. Both
  are NULL for tools that don't carry them and on malformed input (the extractor never throws);
  invariant: every `name='Bash'` node has a non-NULL `bash_command`, and every Read node a `file_path`.
- **Edges are two different relations over the same nodes.** _Containment_ ("child is contained in
  time by parent") is the `parent` self-FK, surfaced per interaction as `tree` (an id-only
  `ExecutionNode` = `{ id, children }`). _Causal_ ("effect triggered by cause") is its own DAG edge
  set (`causalEdges`), introduced in stage 5 and reused unchanged by stage 6.
- **Scope FKs are denormalized onto every node so aggregation is a flat filter, not a parent-walk.**
  `sessionId` is stamped at construction (stage 3, a constant for the pass); `interactionId` (the
  `parent`-closure root — its own id for an interaction node) needs the closure, so it is stamped in
  stage 4 (`aggregate`). Per-interaction aggregation filters `nodes` by `interactionId` instead of
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
     then:   attachToolResults(nodes) (canonical/result/result.ts) completes each
             `tool` node with its outcome — `is_error`, a deterministic `error_kind`
             (no LLM — see rules below), `output_size`, and `error_message`
             (failures only). A tool's result comes back as a `tool_result` block,
             keyed by tool_use_id, in the consuming inference's `request_messages`;
             this indexes those blocks across the session's llm_request nodes and
             annotates the matched tool. `request_messages` is populated by BOTH
             paths, so one pass is harness-agnostic. Unmatched calls keep is_error
             NULL (queryable as such). error_kind rules, matched in priority order
             against the lower-cased text: failed-match edit (`no match` / `string
             to replace` / `not unique`) → invalid_args (a bad old_string, not a
             missing file); `no such file` / `enoent` / `command not found` / `does
             not exist` → not_found; `permission denied` / `eacces` → permission;
             `timed out` / `etimedout` → timeout; other invalid-argument/parse text
             → invalid_args; Bash `exit code N>0` / `killed` → nonzero_exit; else
             → other.
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
        │   (Stage 6 is the final pipeline stage — there is NO curated-analysis
        │    stage. Every rollup one would compute — per-interaction shape /
        │    cost / tokens / longest step, redundant tools, misleading files — is
        │    a one-line query over the materialized tables; see "MCP query
        │    surface". The renderer's one need, the longest main-thread step it
        │    accents, is a small render-time pick in the app's `viz/layout`, not a
        │    shared stage.)
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
node, the ontology-action rollup `coarseAction`, with `shellCommandAction` for shell tools), and the `intents` table (one closed `intent_category` per
interaction node, derived from the prompt by `classifyIntent`), and leaves the `nodes`/`deltas`/edges
untouched — the old copied twin types (`ActionNode`/`InferenceNode`) are retired.

**`nodes.cost_usd` is the traced cost only — never an estimate.** The canonical builder fills it
**iff** the trace itself carries a cost (`resolveCost` in `canonical/transform/transform.ts`); absent
that (the common native-log case) it stays **NULL ("unknown"), never 0**. We deliberately do **not**
back-compute a figure from a model price table: a price-table number is a guess (prices drift, and it
is not what was actually charged), and once written into `cost_usd` it is indistinguishable from a real
cost — so "don't know" is recorded as NULL, not approximated. `intent_category` is 100% non-NULL on
interactions (fallback `other`).

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

There is deliberately **no curated-analysis stage or tool**: a fixed set of hardcoded findings is the
wrong shape for a problem this open-ended. `@coach/mcp` is the **flexible** alternative: it exposes the
stage-6 `ExecutionGraph` as a queryable relational surface so an analyst agent composes its own
analyses, and `describe_schema` ships the would-be findings (cost/shape/repetition/hotspot/misleading
files) as example SQL to extend. This is the deliberate payoff of the normalized, id-keyed model — the
graph "maps 1:1 to a relational DB" (see the node-data/edge tables above), so making it queryable is a
faithful load,
not a reshape.

- **Graph → DB SQL — `@coach/pipeline/db` (pure).** `materializeSql` turns the graph into
  ordered `CREATE`/`INSERT` statements driven entirely by the relation specs aggregated in `db/schema.ts`
  (the single source of truth for both the DDL **and** the `describe_schema` tool, so they cannot drift).
  Each relation's spec lives in its own file — one per table under `db/tables/` and one per view under
  `db/views/` — and `schema.ts` only imports them and orders them into `TABLES` (materialized tables
  first, views last). Tables mirror the model: the three id-keyed node-data layers (`nodes` / `deltas` /
  `semantics`), the two edge relations (`containment` / `causal_edges`), `threads` (layout lanes), and
  the `agents` / `sessions` dimension entities. The `nodes` table promotes common + type-specific columns
  and keeps the full raw node in a `data` JSON column (the escape hatch for un-promoted fields). Span
  timing is the numeric `start_time_ns`/`end_time_ns` **BIGINT** columns — full-precision int64
  nanoseconds (a DOUBLE/JS `number` would lose precision; the `_ns` suffix names the unit), emitted as
  bare integer literals and never round-tripped through a JS number; the same digit strings also survive
  inside the `data` JSON. A dense `seq` INTEGER ranks every node within its owning interaction by
  `start_time_ns` ascending, ties broken by id (`0..n-1`, no gaps) — the materialized form of a
  `ROW_NUMBER()` window. It is a deterministic TOTAL order where `start_time_ns` alone is only partial
  (ties are possible), and a gap-free positional index for "n-th step" / "next step" (`seq+1`)
  arithmetic and adjacency self-joins: `ORDER BY seq` == `ORDER BY start_time_ns, id`. The `sessions` dimension carries `cwd` and
  `branch` (the working directory + git branch a session ran in; populated for native Claude
  sessions, NULL for OTEL traces, which expose neither). The `nodes` table adds a worktree-normalized
  `repo_path` (`db/repo-path.ts`): the file path a tool touched, derived from `tool_input`, collapsed
  to a single repo-relative form so the SAME file accessed under two different git worktrees yields ONE
  `repo_path`. The rule strips any `…/.claude/worktrees/<id>/<rest>` (or bare `worktrees/<id>/`) segment
  to `<rest>`, else makes the path relative to the session's (worktree-normalized) `cwd`; a path that
  lives under any other `.claude/` directory (e.g. the home `~/.claude/projects|plans`) anchors at that
  `.claude/` segment so config files outside the project still read as `.claude/<rest>`; the result
  never contains `/.claude/worktrees/` and never has a leading `/`. No hard-coded prefix. This lives in
  the pipeline because the graph→DB mapping is pure (no `node:*`): the pipeline owns it, the MCP runs it.
  The stage-6 path→object grounding (`graph/semantic/tool-intent.ts`) reuses the same worktree strip
  (`stripWorktreeSegment`) before applying the ontology path conventions, so a source file edited inside
  a worktree grounds to its real object type (source code, documentation) instead of matching the
  `.claude/` agent-config rule on its raw absolute path.
  Beside those base tables sit four **VIEWs** (`db/views/`, one file each), not materialized tables —
  all computed on read against `nodes`, so they **can never disagree with it**, yet still expose flat,
  documented surfaces (`describe_schema` renders a view spec exactly like a table; only the `view` SELECT
  body differs, and `materializeSql` emits `CREATE VIEW` instead of `CREATE TABLE` + `INSERT`s). Views
  appear after `nodes` in `TABLES`, so the relation they select from already exists when they are created.
  One is a **derived rollup** (`interaction_metrics`): a pure aggregate over `nodes`, and in a columnar
  engine a stored copy of an aggregate buys no query power — it only adds a second thing that can drift.
  Three are **per-type projections** (`llm_requests` / `tools` / `interactions`): a typed, documented
  slice of `nodes` filtered to one `type` with the other types' NULL columns dropped — the clean "one
  table per type" surface for an analyst, without splitting the physical table (a columnar engine already
  stores each column separately, so the split would buy no storage and only fragment the single id space
  that edges and traversal join on). Their column docs ARE the `nodes` column docs (projected by name via
  `pickColumns`), so a per-type view can never describe a column differently from the table it projects.
  `interaction_metrics`: one row per interaction, every column a GROUP BY over that interaction's nodes
  (`prompt_len`, `tool_count`/`llm_count`/`error_count`/`distinct_files`, summed `tokens_in`/`tokens_out`/
  `cost_usd`, `duration_ms`, `arg_min`/`arg_max`-over-`seq` `first_action`/`last_action`, and `shape` =
  `'agentic'` iff `tool_count>0` else `'direct'`). The view SQL is proven valid + drift-free against a
  real DuckDB in `mcp/src/duckdb.test.ts` (the views exist, `interaction_metrics` agrees with a direct
  node aggregate, and each per-type view's row count matches its `nodes` slice).
- **Query core — `@coach/mcp` (pure, backend-neutral).** Beside the engine, the MCP holds the analyst
  `Store` (`query-core.ts`): a UX guard (`guard.ts`) + capped, JSON-safe result shaping (`result.ts`) +
  traversal SQL over a `Connection` port — no `node:*` or DB driver, so the same core could later serve
  a browser/WASM backend unchanged.
- **Engine — DuckDB (read-only boundary).** `@coach/mcp`'s `duckdb.ts` is the node-api layer. One way
  in at runtime: `createDuckDbConnection(graph)` materializes the graph into a **temp** DuckDB (removed
  on close). Queries run through a `READ_ONLY` handle with `enable_external_access=false` +
  `lock_configuration=true`. The **engine** is the read-only boundary — there is no keyword
  blocklist; the `Store`'s guard only rejects non-`SELECT`/multi-statement input for a friendly error.
  DuckDB was chosen over the workload scale (tiny) — for JSON columns, analytical SQL, and recursive
  CTEs.
- **`.db` export (`coach-build-db`).** `writePersistedDb(graph, dbPath)` materializes a stage-6 graph
  into a standalone, queryable `.db` — **the query tables only** (no embedded graph). It's a SQL
  snapshot for ad-hoc inspection in the duckdb CLI; coach itself does **not** re-load it (the MCP always
  re-derives from source). `coach-build-db <traces-dir> [out.db]` (root `pnpm build-db`) writes one:
  pipeline in, `.db` out.
- **Tools (`tools.ts`).** Seven, bound to a session (its current dataset): `load_dataset` (point it at
  a directory — runs the pipeline and makes the graph queryable, replacing any prior dataset),
  `describe_schema` (tables + column docs + the semantic ontology vocabulary + example queries,
  including the rollup/finding queries written as SQL — works with nothing loaded), `query` (read-only single
  SELECT/WITH; enforced by the read-only engine, capped at ≤1000 rows **and** a serialized-byte budget
  with `truncated` flagging any cut), `resolve` (hydrate a node id across all
  three layers, reusing the pipeline's `resolve`), `subtree` and `causal_path` (traversal primitives
  over the containment tree / causal DAG, so the agent never hand-writes recursive CTEs), and
  `open_viz` (start a local static server over the built app + the stage JSON dumped into the cwd by
  the last directory load, and hand back a boot URL — `?data=<file>&focus=<nodeId>`).
  There is **no** `get_analysis` tool and no curated-analysis stage: every rollup one would compute is a
  one-line query over these tables (`interaction_metrics`, the promoted `is_error`/`file_path`/`action`
  columns), so the findings ship as `describe_schema` example queries the agent composes — not a frozen
  tool. Tools carry a Zod input shape; the MCP layer validates args.
- **Stage dump + viz server (`dump.ts`, `viz-server.ts`, `bin/viz.ts`).** `dumpPipelineOutputs(result,
outDir)` writes the six `01..06` stage JSON files + a standalone `graph.db` (the tables-only export)
  for one pipeline run and returns the written paths; the `pnpm e2e` CLI and a directory `load_dataset`
  both call it (the load dumps into the cwd and reports the paths in its summary). `startVizServer` is a
  dependency-free `node:http` server that serves the built `@coach/app` (`packages/app/dist`, resolved
  relative to the package) plus those dumped JSON files, erroring with a build hint if `dist` is missing.
  `coach-viz [data-file] [focus]` (its bin) boots the server and opens the browser.
- **CLI front door (`bin/mcp.ts` → `src/cli/cli.ts`).** The `coach-mcp` command has two modes:
  `coach-mcp [dir]` serves the analyst tools over stdio (below), and `coach-mcp init` installs the
  bundled `analyze-traces` skill into the user's skills dir (`~/.claude/skills`, or `./.claude/skills`
  with `--project`) and prints the `claude mcp add coach -- coach-mcp` registration line — never
  clobbering an existing skill without `--force`, writing nothing with `--print-only`. With no dataset
  arg, `resolveStartupDataset` defaults to the user's own Claude Code logs (`~/.claude/projects`) when
  present, else serves empty and points at `load_dataset`. See "Distribution" below.
- **Session + loading (`session.ts`, `load.ts`, `server.ts`, `bin/mcp.ts`).** The server holds one
  mutable session: the dataset currently loaded. `load_dataset` takes a **directory** of trace/native
  files (read into the same `UploadedFile[]` the browser produces, run through the pipeline,
  materialized into a fresh temp store) — it always re-derives, there is no load-a-prebuilt-`.db` path.
  It rebuilds the store (closing the previous one); data-bound tools read through `session.store()` /
  `session.dataset()`, which throw a clear "call load_dataset first" message until something is loaded.
  `coach-mcp [dir]` (root `pnpm mcp`) serves over stdio (`McpServer`) with an **optional** preload
  directory — omit it and the agent loads at runtime. Load-once / serve-many, one dataset at a time.
  Diagnostics go to **stderr only** — stdout is the JSON-RPC channel.

This is the payoff of ending the pipeline at the enriched graph: the same normalized model feeds the
app's renderer and the MCP's flexible SQL surface, and "analysis" is whatever query the agent writes
against it — not a fixed set of findings baked into a stage.

### Distribution (the packaging boundary)

`@coach/mcp` is the one **publishable** package — it ships so a third party can run coach in their own
agent without cloning the monorepo. `tsup` (`tsup.config.ts`) bundles the pure TypeScript workspace
deps (`@coach/pipeline`, `@coach/semantics`, including their imported JSON data) **into** the server
bin `dist/bin/mcp.js`, so the published package carries no unresolved `workspace:*` references. The
native and protocol deps stay **external** real npm deps — `@duckdb/node-api` (a prebuilt native
module that must not be bundled), `@modelcontextprotocol/sdk`, and `zod` — installed from the registry
by the consumer. `package.json#files` ships `dist/` plus the `skills/analyze-traces/SKILL.md` asset;
`bin.coach-mcp` points at the built JS (the `.ts` bins stay dev-only via `pnpm`). The in-repo `exports`
still resolve to `src/` so dev/typecheck/e2e need no build.

The **`analyze-traces` skill** (`packages/mcp/skills/analyze-traces/SKILL.md`) is the shipped source of
truth for how an agent drives the tools (workflow, query recipes, gotchas); `coach-mcp init` copies it
into the user's skills dir. `scripts/smoke-mcp-install.ts` is the cross-repo proof: it builds, `npm
pack`s, installs the tarball into a temp dir outside the worktree, and asserts `init` + an MCP
`tools/list` handshake. `open_viz` is the one tool that does **not** ship standalone — it serves the
built `@coach/app`, which is not in the package; querying and traversal work without it.

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

| Member file                    | Stage | Contents                                                             |
| ------------------------------ | ----- | -------------------------------------------------------------------- |
| `01-classified.json`           | 1     | each file's name/path/type                                           |
| `02-sessions.json`             | 2     | session id, kind, and member filenames per session                   |
| `03-canonical-by-session.json` | 3     | `CanonicalNode[]` per session (each node carries its `sessionId` FK) |
| `04-agent-graph.json`          | 4     | `AgentGraph` — the `nodes` table + `agent`/`sessions` entities       |
| `05-execution-graph.json`      | 5     | `ExecutionGraph` (id-keyed skeleton; `semantics` table empty)        |
| `06-enriched-graph.json`       | 6     | `ExecutionGraph` with the `semantics` table populated (final stage)  |

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
