> **Living document** — update this file in the same change whenever package layout,
> module boundaries, or data flow change. Keep it honest on structural changes; consult
> it before architectural tasks.

# Coach — Architecture

## Overview

Coach processes agent execution traces and renders them as an interactive causal graph.
The core thesis: harness-agnostic OTEL traces feed a pure data pipeline whose output can
be reflected back to the agent (or its engineer) for improvement.

The system is split into four packages plus a Node CLI layer:

```
┌─────────────────────────────────────────────────────────┐
│  @coach/app  (packages/app)                             │
│  React SPA · Upload UI · Graph renderer                 │
│                                                         │
│  upload/UploadPage.tsx ──► data-source.ts ──► viz/App   │
│  (raw logs or pre-computed JSON)                        │
│                               │                         │
│           ┌───────────────────┘                         │
│           ▼                                             │
│  @coach/pipeline (packages/pipeline)                    │
│  Pure data processing · No node:* imports               │
│  classify → route → canonical → aggregate →             │
│            execution graph                              │
└─────────────────────────────────────────────────────────┘

scripts/          Node CLI — reads from disk, writes JSON artifacts
                  depends on @coach/logger for structured output

@coach/logger (packages/logger)   shared pino logger; transport/stream
                                  is the single seam for OTEL/Coralogix/Datadog
```

## Package layout

| Package / dir        | Purpose                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/logger`    | Shared pino logger; the transport/stream is the single seam for sending logs to OTEL/Coralogix/Datadog later.                                                                                                                          |
| `packages/pipeline`  | Pure staged pipeline: classify → route → canonical → aggregate → execution graph → analysis, plus orchestration. Organizes data losslessly; carries no presentation. Zero `node:*` imports — runs in browser and Node alike.           |
| `packages/app`       | React SPA: upload landing page, graph visualization, data-source seam.                                                                                                                                                                 |
| `packages/semantics` | Semantics config as a pure package: Zod schemas + `assembleSemanticsConfig` + the bundled JSON artifacts (`src/data/ontology`, `agents`) + `defaultSemanticsConfig`. JSON is imported (bundled), never read from disk. See its README. |
| `scripts/`           | Node CLI over the same pipeline. Reads fixture files from disk, writes `out/*.json` artifacts. Uses `@coach/logger` for structured log output.                                                                                         |

## Data flow

`packages/pipeline/src/orchestrate.ts` exposes `runPipeline(files, config?): PipelineResult` — seven
named stages, each surfaced as a member: `classified`, `sessions`, `canonicalBySession`,
`agentGraph`, `executionGraph`, `enrichedGraph`, `analysis`. It is pure and file-system-free; the CLI
and the app both call it. Stage 6 enrichment is deterministic and always runs (using `config`,
defaulting to the bundled `defaultSemanticsConfig`). Stage 7 analyzes the enriched graph alone.
`buildVizResults` is a thin adapter that wraps the execution graph for the renderer.

The pipeline **organizes** data; it does not decide how to render it. The execution graph is a
**normalized, stage-layered, id-keyed model** that maps 1:1 to a relational DB, so persistence is a
later drop-in with no reshaping. Three concerns are kept strictly separate:

- **Node data is additive per stage, keyed by a shared node id.** Three id-keyed tables hang off the
  `ExecutionGraph`: `nodes` (stage 3 canonical data — the value type is `CanonicalNode`), `deltas`
  (stage 5 — per-`llm_request` `requestMessagesDelta` / `responseMessagesDelta`, the messages new to
  that step vs. the previous request in the same thread), and `semantics` (stage 6 — per-node `what`
  plus an optional `comment`). `node.id == data.id` across every layer (1:1 joins). A node "points
  to" its data **by id, resolved through a table** (`nodeData` / `deltasOf` / `semanticsOf` /
  `resolve`) — never an embedded object, so nothing re-duplicates on serialize/DB. There is **no
  `action`/`inference` node type**: "is this node enriched?" is answered by "does a `semantics[id]`
  row exist".
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
                            calls, and a (currently empty) failures list; rolled up
                            per session and agent. A function of the
                            `ExecutionGraph` alone, so the live pipeline, the MCP
                            reading a persisted graph, and the app's pre-computed-
                            load path share one derivation. `longestStep` and the
                            critical path moved here OUT of the app's
                            `viz/layout` pass — the moment a second, non-rendering
                            consumer exists, this derivation can't live in the
                            renderer. Observations that aren't yet mechanical (failed
                            tool calls — no status field on ToolNode; retry vs.
                            benign re-read) are surfaced in `gaps`, never dropped.
                            Always runs as the final stage of runPipeline.
        │
        ▼  buildVizResults() adapter → VizResult[]  (one result, execution graph)
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
`semantics` table (one row per relabeled node) and leaves the `nodes`/`deltas`/edges untouched — the
old copied twin types (`ActionNode`/`InferenceNode`) are retired.

All sessions roll up under one agent; `buildVizResults` emits exactly one `VizResult` carrying the
execution graph, and sessions are navigated by expand/collapse inside the graph. Unsupported files
are carried through `classified` (never silently dropped) and surfaced as a count. The graph is
consumed only by the renderer — no raw `CanonicalNode[]` reaches the visualization layer.

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

## Upload flow and the data-source seam

The app has two intake paths, both converging on `VizResult[]` before the renderer:

```
Browser — path 1: raw log files (full pipeline)
  UploadPage.tsx  (accumulating staging UI)
    ├── "Add files" button   → <input multiple>
    ├── "Add folder" button  → <input multiple webkitdirectory>
    └── Drag-and-drop        → DataTransferItem.webkitGetAsEntry() recursive walk
          │  staged Map<path, UploadedFile> — deduped by relative path
          ▼  "Visualize N files" button
    File.text() × N → UploadedFile[] (name=basename, path=relative)
          └── data-source.ts :: processUploads(files)
                └── @coach/pipeline :: buildVizResults(files)
                        └── runPipeline: classify → route → canonical → aggregate
                              → execution graph
                              └── VizResult[]  (one result, execution graph)
                                    └── App.tsx renders the graph (derives all display text)

Browser — path 2: pre-computed pipeline output (bypasses the pipeline)
  UploadPage.tsx  (PipelineOutputLoader)
    └── "Load pipeline output" → <input accept=".json"> single file
          └── data-source.ts :: loadPipelineOutput(jsonText, fileName)
                ├── extractExecutionGraph(raw)   ← detects bare ExecutionGraph
                │     or object wrapping one     ← or wrapper with executionGraph key
                └── @coach/pipeline :: buildVizResultFromExecutionGraph(graph, title)
                      └── VizResult  (file name without extension as title)
                            └── App.tsx renders the graph unchanged
```

**`packages/app/src/data-source.ts` is the single swap point** for moving raw-log
processing to a backend. Replace `processUploads`'s body with a `fetch('/api/process', ...)`
call and nothing else in the app changes — the visualization layer depends only on
`VizResult` / `ExecutionGraph`.

`loadPipelineOutput` and `extractExecutionGraph` live alongside it. The shape-detection
logic is centralized in `extractExecutionGraph`: it accepts a bare `ExecutionGraph` (the
e2e script's direct output) or any object with an `executionGraph` member, tolerating the
pipeline output format being reworked.

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

Native `.jsonl`, single/multi-trace OTEL sets, and mixes of both in one upload all flow through
the same pipeline. The CLI populates `UploadedFile.path` relative to the gather root so the
same session-id routing (with directory fallback for logs) that powers the browser upload applies.

## Deploying to Vercel (static SPA)

The app builds to static assets — no serverless functions.

```
Root directory:  packages/app
Build command:   pnpm --filter @coach/app build
Output dir:      packages/app/dist
Install command: pnpm install (at repo root)
```

See `vercel.json` for the committed configuration.
