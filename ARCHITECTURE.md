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
| `packages/pipeline`  | Pure staged pipeline: classify → route → canonical → aggregate → execution graph, plus orchestration. Organizes data losslessly; carries no presentation. Zero `node:*` imports — runs in browser and Node alike.                      |
| `packages/app`       | React SPA: upload landing page, graph visualization, data-source seam.                                                                                                                                                                 |
| `packages/semantics` | Semantics config as a pure package: Zod schemas + `assembleSemanticsConfig` + the bundled JSON artifacts (`src/data/ontology`, `agents`) + `defaultSemanticsConfig`. JSON is imported (bundled), never read from disk. See its README. |
| `scripts/`           | Node CLI over the same pipeline. Reads fixture files from disk, writes `out/*.json` artifacts. Uses `@coach/logger` for structured log output.                                                                                         |

## Data flow

`packages/pipeline/src/orchestrate.ts` exposes `runPipeline(files, config?): PipelineResult` — six
named stages, each surfaced as a member: `classified`, `sessions`, `canonicalBySession`,
`agentGraph`, `executionGraph`, `enrichedGraph`. It is pure and file-system-free; the CLI and the app
both call it. Stage 6 enrichment is deterministic and always runs (using `config`, defaulting to the
bundled `defaultSemanticsConfig`). `buildVizResults` is a thin adapter that wraps the execution graph
for the renderer.

The pipeline **organizes** data; it does not decide how to render it. Graph nodes are **lossless**
(each carries its full `CanonicalNode`) and carry **no formatted presentation** — no `labelLines`,
no "+12ms" strings, no truncated titles. Presentation/label formatting was de-leaked out of the
pipeline and into the app: the app derives all display text from the structured graph data.
Beside `canonical`, execution nodes may carry **derived structural fields** that need thread
ordering to compute — `requestMessagesDelta` / `responseMessagesDelta` on `llm_request` steps,
the messages new to that step relative to the previous request in the same thread.

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
     both:   addSessionNode()
        │
        ▼  Stage 4 — aggregate/aggregate.ts      → agentGraph: CanonicalNode[]
   aggregateSession()   merge all sessions → forest (dedupe by id)
   aggregateAgent()     add the single agent root (multi-agent is out of scope)
        │
        ▼  Stage 5 — graph/execution/execution.ts  → executionGraph: ExecutionGraph
   buildExecutionGraph()  the mechanical skeleton from the trace, no interpretation:
                            agent ▸ session ▸ interaction ▸ thread ▸ step
                            each interaction has a synthesized user_prompt head node
                            (its input / goal source) carrying the full prompt — not a step
                            llm_request steps carry requestMessagesDelta /
                            responseMessagesDelta — the messages new to that step
                            vs. the previous request in the same thread
                            edges are two layers: `sequence` edges order steps in
                            time within a lane (NO gap — adjacency ≠ causality), and
                            graph/execution/causal.ts derives the `causal` DAG that
                            overlays them: inference → tool (fan-out, the response
                            emitted that tool_use id) and tool → inference (fan-in,
                            the request consumed that tool_result). Built from
                            tool_use_id correlation, never timing; the signed gapMs
                            lives here (fan-out gaps go negative under streamed
                            dispatch). InteractionExecution.causalEdges holds them.
        │
        ▼  Stage 6 — graph/semantic/semantic.ts  → ExecutionGraph (enriched)
   enrichExecutionGraph(graph, config)  converts tool → action and llm_request →
                            inference nodes. tool-intent.ts + derive.ts label each
                            node deterministically (tool intent, path conventions,
                            thinking→plan, tool_use→invoke, session-title,
                            suggestion-mode) by interpreting the injected SemanticsConfig
                            — no hardcoded tool tables, no model. A genuine terminal
                            assistant message is labeled with the generic `respond`
                            act. Always runs as the final stage of runPipeline.
        │
        ▼  buildVizResults() adapter → VizResult[]  (one result, execution graph)
        ▼  packages/app/src/viz/App  (React Flow graph renderer)
```

`agentGraph` is itself a visualisable graph (the canonical node forest). The execution graph is the
deterministic skeleton from the trace. `VizResult.data` is the `ExecutionGraph` directly.

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
what is deliberately out of scope (composition/inference roll-up).

All sessions roll up under one agent; `buildVizResults` emits exactly one `VizResult` carrying the
execution graph, and sessions are navigated by expand/collapse inside the graph. Unsupported files
are carried through `classified` (never silently dropped) and surfaced as a count. The graph is
consumed only by the renderer — no raw `CanonicalNode[]` reaches the visualization layer.

**Display derives from structure, never content.** `viz/format/format.ts` turns each node's
`canonical` into a typed `NodeCard` — a curated, at-a-glance summary (display type, title,
structural key/values, numeric metrics) drawn on the node. The card reads only fields the
canonical model guarantees; it never interprets harness-shaped content (response content blocks,
`tool_input` JSON). That content flows untouched into a generic JSON tree (`viz/JsonView`,
backed by `@uiw/react-json-view`) shown in the details panel. Net effect: new node types or
content shapes from the pipeline render in the viewer for free; only the curated card touches
`format.ts`. The renderer consumes the typed `NodeCard` (and raw `canonical` for the viewer) —
no stringly-typed label arrays.

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

| Member file                    | Stage | Contents                                                    |
| ------------------------------ | ----- | ----------------------------------------------------------- |
| `01-classified.json`           | 1     | each file's name/path/type                                  |
| `02-sessions.json`             | 2     | session id, kind, and member filenames per session          |
| `03-canonical-by-session.json` | 3     | `CanonicalNode[]` per session                               |
| `04-agent-graph.json`          | 4     | the single-agent `CanonicalNode[]` forest                   |
| `05-execution-graph.json`      | 5     | `ExecutionGraph` (the mechanical skeleton)                  |
| `06-enriched-graph.json`       | 6     | `ExecutionGraph` with deterministic action/inference labels |

Native `.jsonl`, single/multi-trace OTEL sets, and mixes of both in one upload all flow through
the same five stages. The CLI populates `UploadedFile.path` relative to the gather root so the
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
