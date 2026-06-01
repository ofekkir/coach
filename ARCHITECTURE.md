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
Input files
  *.jsonl                 native Claude Code session logs
  logs.json + trace*.json OTEL Tempo traces + structured log entries
        │
        ▼  packages/pipeline/src/etl/
   nativeSessionToTrace()    (*.jsonl → TempoTrace)
   enrichTrace()             (TempoTrace + LogEntry[] → enriched TempoTrace)
   transformTrace()          (TempoTrace → TraceNode[])
   addSessionNode()          (synthesise session node)
        │
        ▼  packages/pipeline/src/etl/aggregate.ts
   aggregateSession()        (merge multi-trace → session forest)
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

View models are built bottom-up and consumed only by the renderer — no raw `TraceNode[]`
reaches the visualization layer.

## Upload flow and the data-source seam

```
Browser
  UploadPage.tsx
    └── File.text() × N → UploadedFile[]
          └── data-source.ts :: processUploads(files)
                └── @coach/pipeline :: buildVizResults(files)   ← CURRENT
                        └── ETL + aggregate + view model
                              └── VizResult[]
                                    └── App.tsx renders graph
```

**`packages/app/src/data-source.ts` is the single swap point** for moving processing to a
backend. Replace its body with a `fetch('/api/process', ...)` call and nothing else in the
app changes — the visualization layer depends only on `VizResult` / `VizData`.

## Fixture modes

`pnpm e2e` accepts a path (relative to cwd) or a fixture name under
`packages/pipeline/fixtures/`.

| Input shape                        | Mode                | Artifacts produced                                        |
| ---------------------------------- | ------------------- | --------------------------------------------------------- |
| `<dir>/*.jsonl`                    | Native session      | `vizdata-<name>.json` per file                            |
| `<dir>/logs.json` + `trace.json`   | Single OTEL trace   | `vizdata-trace.json`                                      |
| `<dir>/logs.json` + `trace-*.json` | Multi-trace session | per-trace + `vizdata-session.json` + `vizdata-agent.json` |
| `<dir>/` containing session dirs   | Multi-session       | all of the above, grouped by dir                          |

Multi-session-by-`user_id` is supported by the CLI (directory walking). Flat browser
upload of multi-session data is a future item; consider `<input webkitdirectory>`.

## Deploying to Vercel (static SPA)

The app builds to static assets — no serverless functions.

```
Root directory:  packages/app
Build command:   pnpm --filter @coach/app build
Output dir:      packages/app/dist
Install command: pnpm install (at repo root)
```

See `vercel.json` for the committed configuration.
