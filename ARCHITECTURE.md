> **Living document** — update this file in the same change whenever package layout,
> module boundaries, or data flow change. Keep it honest on structural changes; consult
> it before architectural tasks.

# Coach — Architecture

## Overview

Coach processes agent execution traces and renders them as an interactive causal graph.
The core thesis: harness-agnostic OTEL traces feed a pure data pipeline whose output can
be reflected back to the agent (or its engineer) for improvement.

The system is split into two packages plus a Node CLI layer:

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
│  ETL → Aggregate → View model → VizData                 │
└─────────────────────────────────────────────────────────┘

scripts/          Node CLI — reads from disk, writes JSON artifacts
```

## Package layout

| Package / dir       | Purpose                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/pipeline` | Pure data pipeline: ETL, aggregation, view-model, orchestration. Zero `node:*` imports — runs in browser and Node alike. |
| `packages/app`      | React SPA: upload landing page, graph visualization, data-source seam.                                                   |
| `scripts/`          | Node CLI over the same pipeline. Reads fixture files from disk, writes `out/*.json` artifacts.                           |

## Data flow

```
Input files (accumulating — user stages N files/folders before submitting)
  *.jsonl                           native Claude Code session logs
  <dir>/logs.json + trace*.json     OTEL Tempo traces + structured log entries
        │
        ▼  packages/pipeline/src/orchestrate.ts  buildVizResults()
   Files bucketed by source directory (path prefix):
     native .jsonl → one session per file
     OTEL bucket  → processOtelSet() per directory, then aggregateSession()
   All session node-arrays grouped by agent id:
     user.id present  → group under that id
     user.id absent   → group under shared synthetic id ("agent-upload")
        │
        ▼  packages/pipeline/src/etl/
   nativeSessionToTrace()    (*.jsonl → TempoTrace)
   enrichTrace()             (TempoTrace + LogEntry[] → enriched TempoTrace)
   transformTrace()          (TempoTrace → TraceNode[])
   addSessionNode()          (synthesise session node)
        │
        ▼  packages/pipeline/src/etl/aggregate.ts
   aggregateSession()        (merge multi-trace/multi-session → forest)
   groupSessionsByAgent()    (bucket by user.id or synthetic id)
   aggregateAgent()          (add agent root node)
        │
        ▼  packages/pipeline/src/graph/view-model.ts
   buildCausalGraphView()        → CausalGraphView
   buildSessionCausalGraphView() → SessionCausalGraphView
   buildAgentCausalGraphView()   → AgentCausalGraphView
        │
        ▼  VizData  { kind: 'agent'|'session'|'interaction', data }
        │
        ▼  packages/app/src/viz/App.tsx  (React Flow graph renderer)
```

`buildVizResults` always emits **one `VizResult` per agent** (expected: exactly one).
Sessions are navigated by expand/collapse inside the agent graph — not by switching results.
If multiple distinct `user.id`s appear in one upload, one result per agent is emitted with
a console warning; a multi-agent selector UI is out of scope.

View models are built bottom-up and consumed only by the renderer — no raw `TraceNode[]`
reaches the visualization layer.

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
                        └── bucket by dir → ETL → aggregate → view model
                              └── VizResult[]  (one per agent; expected: one)
                                    └── App.tsx renders agent graph
```

**`packages/app/src/data-source.ts` is the single swap point** for moving processing to a
backend. Replace its body with a `fetch('/api/process', ...)` call and nothing else in the
app changes — the visualization layer depends only on `VizResult` / `VizData`.

## Fixture modes

`pnpm e2e` accepts a path (relative to cwd) or a fixture name under
`packages/pipeline/fixtures/`.

| Input shape                               | Mode                      | Artifacts in `out/`  |
| ----------------------------------------- | ------------------------- | -------------------- |
| `<dir>/*.jsonl`                           | Native sessions           | `vizdata-agent.json` |
| `<dir>/logs.json` + `trace*.json`         | Single OTEL session       | `vizdata-agent.json` |
| `<dir>/` containing session subdirs       | Multi-session (multi-dir) | `vizdata-agent.json` |
| Mix of `.jsonl` + OTEL dirs in one upload | All sessions → one agent  | `vizdata-agent.json` |

The CLI populates `UploadedFile.path` relative to the gather root so the same
directory-bucketing logic in `buildVizResults` that powers the browser upload applies.

## Deploying to Vercel (static SPA)

The app builds to static assets — no serverless functions.

```
Root directory:  packages/app
Build command:   pnpm --filter @coach/app build
Output dir:      packages/app/dist
Install command: pnpm install (at repo root)
```

See `vercel.json` for the committed configuration.
