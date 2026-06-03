# coach

Improve agent harnesses — accuracy, latency, cost, and detection of hallucinations and operational
errors — through **OpenTelemetry (OTEL) trace analysis**. OTEL keeps coach **harness-agnostic**.

Unlike tracing built for engineers to observe agents, coach aims to reflect findings back to the
**agent itself**, with the engineer monitoring that loop. Stage one targets the engineer until we
learn which problems are solvable.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full picture: package layout, data flow, upload
seam, and Vercel deployment.

## Pipeline

`runPipeline(files)` (@coach/pipeline) runs five named stages, each exposed as a member of
the returned `PipelineResult`:

```
UploadedFile[]   (*.jsonl · logs.json + trace*.json)
        │
        ▼ 1. classify        every file tagged: otel-trace | otel-log | native | unsupported
        ▼ 2. route           supported inputs grouped by session id (logs fall back to dir)
        ▼ 3. canonical       per session → CanonicalNode[]
                               otel:   join traces → enrich with logs → transform (one pass)
                               native: jsonl → CanonicalNode[]  (OTLP round-trip behind a facade)
        ▼ 4. aggregate       all sessions under one agent → agentGraph (CanonicalNode[])
        ▼ 5. view-model      buildCausalGraphView family → viewModel (VizData)
        │
        ▼ React Flow graph   (@coach/app, via the buildVizResults adapter)
```

`agentGraph` is itself a visualisable graph; `viewModel` is the verb/move/segment view-model —
one of several graphs we expect to add. View models are consumed only by the renderer; no raw
`CanonicalNode[]` reaches the visualization layer.

### Upload model

Inputs are classified, then grouped by **session id** — OTEL traces carry `session.id`, native
`.jsonl` carries `sessionId`, and OTEL logs use their `session_id` (falling back to the traces in
their directory). A session is assumed wholly OTEL or wholly native. All sessions roll up under a
single **agent** (multi-agent is out of scope). Use the staging UI to mix files and folders freely.

### Fixtures

`pnpm e2e` accepts a path (relative to cwd) or a fixture name under
`packages/pipeline/fixtures/`. It dumps each stage member to `out/<name>/`:
`01-classified.json`, `02-sessions.json`, `03-canonical-by-session.json`,
`04-agent-graph.json`, `05-view-model.json`.

## Quick start

```bash
pnpm install
pnpm check             # typecheck + lint + format + test + knip (same as CI)
pnpm --filter @coach/app dev   # upload landing page at http://localhost:5173
```

## Development

| Command                                    | What it does                                   |
| ------------------------------------------ | ---------------------------------------------- |
| `pnpm check`                               | Full gate: typecheck, lint, format, test, knip |
| `pnpm lint:fix`                            | Auto-fix lint issues                           |
| `pnpm format`                              | Auto-format with Prettier                      |
| `pnpm --filter @coach/pipeline test:watch` | Vitest in watch mode                           |
| `pnpm e2e <fixture>`                       | Run pipeline on a fixture, write `out/`        |
| `pnpm enrich <fixture>`                    | Enrich a single OTEL trace fixture             |

## Contributing workflow

- Branch off `main`; **never commit to `main` directly**.
- Open a PR — CI runs on open, on every push to the branch, and on pushes to `main`.

### Recommended one-time setup (requires a GitHub remote)

Make CI a required check so PRs can't merge red:

```bash
gh api -X PUT repos/{owner}/{repo}/branches/main/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=check' \
  -F enforce_admins=true \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F restrictions=
```
