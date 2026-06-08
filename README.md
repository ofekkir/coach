# coach

Improve agent harnesses — accuracy, latency, cost, and detection of hallucinations and operational
errors — through **OpenTelemetry (OTEL) trace analysis**. OTEL keeps coach **harness-agnostic**.

Unlike tracing built for engineers to observe agents, coach aims to reflect findings back to the
**agent itself**, with the engineer monitoring that loop. Stage one targets the engineer until we
learn which problems are solvable.

An emerging **second pillar** sits beside that optimization work: because coach holds _complete
sessions_ and _many of them_, it can infer user **intent in hindsight** and aggregate it across
sessions into a per-agent **user model** (what users want, how they phrase it, what they leave
unsaid) — a personalization signal population-level RLHF cannot produce. See
**[docs/agent-model.md](docs/agent-model.md)** for the conceptual model.

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
        ▼ 5. execution graph buildExecutionGraph → executionGraph (ExecutionGraph)
                               the mechanical skeleton: agent ▸ session ▸ interaction ▸ thread ▸ step
        ▼ 6. semantic graph  enrichExecutionGraph → ExecutionGraph (opt-in, requires --enrich)
                               tool → action  ·  llm_request → inference  (LLM-labeled one-liners)
                               pure stage; LLM adapter (local Ollama, claude CLI opt-in) injected by e2e only
        │
        ▼ React Flow graph   (@coach/app, via the buildVizResults adapter)
```

`agentGraph` is itself a visualisable graph. The **execution graph** is the deterministic skeleton.
`VizResult.data` is the `ExecutionGraph` directly. The pipeline organizes data losslessly and
carries no presentation — the app derives all display text. The graph is consumed only by the
renderer; no raw `CanonicalNode[]` reaches the visualization layer.

### Upload model

Inputs are classified, then grouped by **session id** — OTEL traces carry `session.id`, native
`.jsonl` carries `sessionId`, and OTEL logs use their `session_id` (falling back to the traces in
their directory). A session is assumed wholly OTEL or wholly native. All sessions roll up under a
single **agent** (multi-agent is out of scope). Use the staging UI to mix files and folders freely.

### Fixtures

`pnpm e2e` accepts a path (relative to cwd) or a fixture name under
`packages/pipeline/fixtures/`. It dumps each stage member to `out/<name>/`:
`01-classified.json`, `02-sessions.json`, `03-canonical-by-session.json`,
`04-agent-graph.json`, `05-execution-graph.json`.

Pass `--enrich` to also run the semantic enrichment stage and write
`06-enriched-graph.json`. By default this labels batches via a **local Ollama**
model (`OLLAMA_MODEL`, default `llama3.2:3b`, at `OLLAMA_HOST`, default
`http://localhost:11434`) using JSON-schema-constrained output. Set
`COACH_LABELER=claude` to use the cloud Claude CLI (`claude -p`,
`claude-haiku-4-5`) instead. The enriched graph is loadable by the app's
"Load pipeline output" button.

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
| `pnpm e2e <fixture> --enrich`              | Also run semantic enrichment (calls Claude)    |

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
