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
│                               │                         │
│           ┌───────────────────┘                         │
│           ▼                                             │
│  @coach/pipeline (packages/pipeline)                    │
│  Pure data processing · No node:* imports               │
│  classify → route → canonical → aggregate → view-model  │
└─────────────────────────────────────────────────────────┘

scripts/          Node CLI — reads from disk, writes JSON artifacts
                  depends on @coach/logger for structured output

@coach/logger (packages/logger)   shared pino logger; transport/stream
                                  is the single seam for OTEL/Coralogix/Datadog
```

## Package layout

| Package / dir       | Purpose                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/logger`   | Shared pino logger; the transport/stream is the single seam for sending logs to OTEL/Coralogix/Datadog later.                                            |
| `packages/pipeline` | Pure staged pipeline: classify → route → canonical → aggregate → view-model, plus orchestration. Zero `node:*` imports — runs in browser and Node alike. |
| `packages/app`      | React SPA: upload landing page, graph visualization, data-source seam.                                                                                   |
| `scripts/`          | Node CLI over the same pipeline. Reads fixture files from disk, writes `out/*.json` artifacts. Uses `@coach/logger` for structured log output.           |

## Data flow

`packages/pipeline/src/orchestrate.ts` exposes `runPipeline(files): PipelineResult` — five
named stages, each surfaced as a member. It is pure and file-system-free; the CLI and the app
both call it. `buildVizResults` is a thin adapter that wraps the final member for the renderer.

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
        ▼  Stage 5 — graph/view-model/*          → viewModel: VizData
   buildCausalGraphView() / buildSessionCausalGraphView() / buildAgentCausalGraphView()
        │
        ▼  buildVizResults() adapter → VizResult[]  (one result)
        ▼  packages/app/src/viz/App  (React Flow graph renderer)
```

`agentGraph` is itself a visualisable graph (the canonical node forest); `viewModel` is the
verb/move/segment view-model — one of several graphs we expect to add. Renaming/splitting
`VizData` into per-graph types is deliberately deferred to a later branch.

All sessions roll up under one agent; `buildVizResults` emits exactly one `VizResult`, and
sessions are navigated by expand/collapse inside the agent graph. Unsupported files are carried
through `classified` (never silently dropped) and surfaced as a count. View models are consumed
only by the renderer — no raw `CanonicalNode[]` reaches the visualization layer.

## Upload flow and the data-source seam

```
Browser
  UploadPage.tsx  (accumulating staging UI)
    ├── "Add files" button   → <input multiple>
    ├── "Add folder" button  → <input multiple webkitdirectory>
    └── Drag-and-drop        → DataTransferItem.webkitGetAsEntry() recursive walk
          │  staged Map<path, UploadedFile> — deduped by relative path
          ▼  "Visualize N files" button
    File.text() × N → UploadedFile[] (name=basename, path=relative)
          └── data-source.ts :: processUploads(files)
                └── @coach/pipeline :: buildVizResults(files)
                        └── runPipeline: classify → route → canonical → aggregate → view-model
                              └── VizResult[]  (one result)
                                    └── App.tsx renders agent graph
```

**`packages/app/src/data-source.ts` is the single swap point** for moving processing to a
backend. Replace its body with a `fetch('/api/process', ...)` call and nothing else in the
app changes — the visualization layer depends only on `VizResult` / `VizData`.

## Fixture modes

`pnpm e2e` accepts a path (relative to cwd) or a fixture name under
`packages/pipeline/fixtures/`. It calls `runPipeline` and dumps every stage member to
`out/<name>/`, so each stage is independently inspectable:

| Member file                    | Stage | Contents                                           |
| ------------------------------ | ----- | -------------------------------------------------- |
| `01-classified.json`           | 1     | each file's name/path/type                         |
| `02-sessions.json`             | 2     | session id, kind, and member filenames per session |
| `03-canonical-by-session.json` | 3     | `CanonicalNode[]` per session                      |
| `04-agent-graph.json`          | 4     | the single-agent `CanonicalNode[]` forest          |
| `05-view-model.json`           | 5     | `VizData` (the renderer's input)                   |

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
