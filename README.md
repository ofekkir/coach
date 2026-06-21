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

`runPipeline(files)` (@coach/pipeline) runs six named stages, each exposed as a member of
the returned `PipelineResult`:

```
UploadedFile[]   (*.jsonl · logs.json + trace*.json)
        │
        ▼ 1. classify        every file tagged: otel-trace | otel-log | native | unsupported
        ▼ 2. route           supported inputs grouped by session id (logs fall back to dir)
        ▼ 3. canonical       per session → CanonicalNode[]  (each node carries a sessionId FK)
                               otel:   join traces → enrich with logs → transform (one pass)
                               native: jsonl → CanonicalNode[]  (OTLP round-trip behind a facade)
        ▼ 4. aggregate       all sessions → agentGraph = nodes table + agent/sessions entities
        ▼ 5. execution graph buildExecutionGraph → executionGraph (ExecutionGraph)
                               id-keyed, stage-layered: nodes/deltas/semantics tables + entities;
                               edges are containment (tree) and causal (causalEdges)
        ▼ 6. semantic graph  enrichExecutionGraph → ExecutionGraph
                               pure table pass: writes a semantics[id] row per tool / llm_request
                               deterministic; labels come from @coach/semantics (no model)
        │
        ▼ React Flow graph   (@coach/app renders a pre-computed ExecutionGraph)
```

The **execution graph** is the deterministic skeleton — a normalized, id-keyed model that maps 1:1
to a relational DB (`agents`, `sessions`, `nodes`, `node_deltas`, `node_semantics`, `causal_edges`).
`VizResult.data` is the `ExecutionGraph` directly. The pipeline organizes data losslessly and
carries no presentation — the app resolves each node id against the graph tables and derives all
display text. The graph is consumed only by the renderer.

### Upload model

Inputs are classified, then grouped by **session id** — OTEL traces carry `session.id`, native
`.jsonl` carries `sessionId`, and OTEL logs use their `session_id` (falling back to the traces in
their directory). A session is assumed wholly OTEL or wholly native. All sessions roll up under a
single **agent** (multi-agent is out of scope).

The pipeline runs offline (the CLI `pnpm e2e`, or the MCP server). The app no longer runs it in the
browser: it renders a **pre-computed execution graph**. Load one via the "Load pipeline output"
button, or boot directly from a URL with `?data=<url>` (fetches the JSON and renders it).
`?focus=<nodeId>` then reveals, selects, and centers that node — the same effect as the search box.

### Fixtures

`pnpm e2e` accepts a path (relative to cwd) or a fixture name under
`packages/pipeline/fixtures/`. It dumps each stage member to `out/<name>/`:
`01-classified.json`, `02-sessions.json`, `03-canonical-by-session.json`,
`04-agent-graph.json`, `05-execution-graph.json`, and the semantically-enriched
`06-enriched-graph.json`.

Stage 6 is **deterministic** — every label comes from the bundled `@coach/semantics`
config (tool intent, path conventions, structural roles, harness markers); no model
is involved. A model-based labeler that classified the _act_ of terminal assistant
messages more finely (answer / confirm / suggest …) was removed for now; such turns
are labeled with the generic `respond` act. The enriched graph is loadable by the
app's "Load pipeline output" button.

## Quick start

```bash
pnpm install
pnpm check             # typecheck + lint + format + test + knip (same as CI)
pnpm --filter @coach/app dev   # load-pipeline-output landing page at http://localhost:5173
```

## Development

| Command                                    | What it does                                          |
| ------------------------------------------ | ----------------------------------------------------- |
| `pnpm check`                               | Full gate: typecheck, lint, format, test, knip        |
| `pnpm lint:fix`                            | Auto-fix lint issues                                  |
| `pnpm format`                              | Auto-format with Prettier                             |
| `pnpm --filter @coach/pipeline test:watch` | Vitest in watch mode                                  |
| `pnpm e2e <fixture>`                       | Run pipeline + deterministic enrichment, write `out/` |

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
