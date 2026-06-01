# coach

Improve agent harnesses — accuracy, latency, cost, and detection of hallucinations and operational
errors — through **OpenTelemetry (OTEL) trace analysis**. OTEL keeps coach **harness-agnostic**.

Unlike tracing built for engineers to observe agents, coach aims to reflect findings back to the
**agent itself**, with the engineer monitoring that loop. Stage one targets the engineer until we
learn which problems are solvable.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full picture: package layout, data flow, upload
seam, and Vercel deployment.

## Pipeline

```
*.jsonl / logs.json + trace*.json
        │
        ▼ ETL  (@coach/pipeline)
   nativeSessionToTrace / enrichTrace → transformTrace → addSessionNode
        │
        ▼ Aggregation
   aggregateSession  ·  groupSessionsByAgent → aggregateAgent
        │
        ▼ View model
   buildCausalGraphView        → CausalGraphView
   buildSessionCausalGraphView → SessionCausalGraphView
   buildAgentCausalGraphView   → AgentCausalGraphView
        │
        ▼ VizData  { kind: 'agent' | 'session' | 'interaction', data }
        │
        ▼ React Flow graph  (@coach/app)
```

View models are built bottom-up and consumed only by the graph renderer — no raw
`TraceNode[]` reaches the visualization layer.

### Upload model

Each uploaded file or OTEL set (one directory of `logs.json` + `trace*.json`) is treated as
one **session**. All sessions roll up under a single **agent** view. Use the accumulating
staging UI to add files and folders before submitting — mix `.jsonl` and OTEL sets freely.

### Fixture modes

`pnpm e2e` accepts a path (relative to cwd) or a fixture name under
`packages/pipeline/fixtures/`.

| Input shape                         | Mode                      | Artifacts in `out/`  |
| ----------------------------------- | ------------------------- | -------------------- |
| `<dir>/*.jsonl`                     | Native sessions           | `vizdata-agent.json` |
| `<dir>/logs.json` + `trace*.json`   | Single OTEL session       | `vizdata-agent.json` |
| `<dir>/` containing session subdirs | Multi-session (multi-dir) | `vizdata-agent.json` |

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
