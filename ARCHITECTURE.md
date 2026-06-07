> **Living document** — update this file in the same change whenever package layout,
> module boundaries, or data flow change. Keep it honest on structural changes; consult
> it before architectural tasks.

# Coach — Architecture

## Overview

Coach processes agent execution traces and renders them as an interactive causal graph.
The core thesis: harness-agnostic OTEL traces feed a pure data pipeline whose output can
be reflected back to the agent (or its engineer) for improvement.

The system is split into three packages plus a Node CLI layer:

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
│            execution graph → semantic graph             │
└─────────────────────────────────────────────────────────┘

scripts/          Node CLI — reads from disk, writes JSON artifacts
                  depends on @coach/logger for structured output

@coach/logger (packages/logger)   shared pino logger; transport/stream
                                  is the single seam for OTEL/Coralogix/Datadog
```

## Package layout

| Package / dir       | Purpose                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/logger`   | Shared pino logger; the transport/stream is the single seam for sending logs to OTEL/Coralogix/Datadog later.                                                                                                                      |
| `packages/pipeline` | Pure staged pipeline: classify → route → canonical → aggregate → execution graph → semantic graph, plus orchestration. Organizes data losslessly; carries no presentation. Zero `node:*` imports — runs in browser and Node alike. |
| `packages/app`      | React SPA: upload landing page, graph visualization, data-source seam.                                                                                                                                                             |
| `scripts/`          | Node CLI over the same pipeline. Reads fixture files from disk, writes `out/*.json` artifacts. Uses `@coach/logger` for structured log output.                                                                                     |

## Data flow

`packages/pipeline/src/orchestrate.ts` exposes `runPipeline(files): PipelineResult` — six
named stages, each surfaced as a member: `classified`, `sessions`, `canonicalBySession`,
`agentGraph`, `executionGraph`, `semanticGraph`. It is pure and file-system-free; the CLI and the
app both call it. `buildVizResults` is a thin adapter that wraps the two graphs for the renderer.

The pipeline **organizes** data; it does not decide how to render it. Graph nodes are **lossless**
(each carries its full `CanonicalNode`) and carry **no formatted presentation** — no `labelLines`,
no "+12ms" strings, no truncated titles. Presentation/label formatting was de-leaked out of the
pipeline and into the app: the app derives all display text from the structured graph data.

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
        │
        ▼  Stage 6 — graph/semantic/semantic.ts     → semanticGraph: SemanticGraph
   buildSemanticGraph(executionGraph)  Coach's inferred layer laid over execution:
                            per interaction → per thread, steps group into segments
                            (sub-goals). A step (inference|action, + verbs/moves) WRAPS one
                            execution node — structural sharing, not copies. V1 segments
                            per thread, preserving threading (segmentation is still a stub).
        │
        ▼  buildVizResults() adapter → VizResult[]  (one result, both graphs)
        ▼  packages/app/src/viz/App  (React Flow graph renderer, two tabs)
```

`agentGraph` is itself a visualisable graph (the canonical node forest). The execution graph is the
deterministic skeleton; the semantic graph takes that skeleton as input and attaches the inferred
sub-goal/verb overlay at the interaction level — reusing the same `ExecutionNode` instances as one
source of truth.

All sessions roll up under one agent; `buildVizResults` emits exactly one `VizResult` carrying both
graphs, and sessions are navigated by expand/collapse inside the graph. Unsupported files are
carried through `classified` (never silently dropped) and surfaced as a count. The graphs are
consumed only by the renderer — no raw `CanonicalNode[]` reaches the visualization layer.

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
                              → execution graph → semantic graph
                              └── VizResult[]  (one result, both graphs)
                                    └── App.tsx renders the graph (derives all display text)

Browser — path 2: pre-computed pipeline output (bypasses the pipeline)
  UploadPage.tsx  (PipelineOutputLoader)
    └── "Load pipeline output" → <input accept=".json"> single file
          └── data-source.ts :: loadPipelineOutput(jsonText, fileName)
                ├── extractExecutionGraph(raw)   ← detects bare ExecutionGraph
                │     or object wrapping one     ← or wrapper with executionGraph key
                └── @coach/pipeline :: buildVizResultFromExecutionGraph(graph, title)
                      └── buildSemanticGraph(graph) — derived in-browser from the graph
                            └── VizResult  (file name without extension as title)
                                  └── App.tsx renders the graph unchanged
```

**`packages/app/src/data-source.ts` is the single swap point** for moving raw-log
processing to a backend. Replace `processUploads`'s body with a `fetch('/api/process', ...)`
call and nothing else in the app changes — the visualization layer depends only on
`VizResult` / `GraphData`.

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

| Member file                    | Stage | Contents                                           |
| ------------------------------ | ----- | -------------------------------------------------- |
| `01-classified.json`           | 1     | each file's name/path/type                         |
| `02-sessions.json`             | 2     | session id, kind, and member filenames per session |
| `03-canonical-by-session.json` | 3     | `CanonicalNode[]` per session                      |
| `04-agent-graph.json`          | 4     | the single-agent `CanonicalNode[]` forest          |
| `05-execution-graph.json`      | 5     | `ExecutionGraph` (the mechanical skeleton)         |
| `06-semantic-graph.json`       | 6     | `SemanticGraph` (the inferred overlay)             |

Native `.jsonl`, single/multi-trace OTEL sets, and mixes of both in one upload all flow through
the same six stages. The CLI populates `UploadedFile.path` relative to the gather root so the
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
