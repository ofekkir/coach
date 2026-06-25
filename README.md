# coach

**The agent grades itself.** Coach turns an agent's own execution traces into a queryable model of
what it did — then hands that model back to the agent through MCP, so Claude Code can load its own
sessions and surface its own expensive, hallucinated, or wasteful steps. Existing agent tracing is
built for the _engineer_ to observe the agent; coach's north star is to close that loop back to the
**agent itself**, with the engineer monitoring the loop.

It works on **OpenTelemetry (OTEL) traces** by design, which keeps coach **harness-agnostic**.

A **second pillar** sits beside that optimization work: because coach holds _complete sessions_ and
_many of them_, it aims to infer user **intent in hindsight** and aggregate it across sessions into
a per-agent **user model** (what users want, how they phrase it, what they leave unsaid) — a
personalization signal population-level RLHF cannot produce. See
**[docs/agent-model.md](docs/agent-model.md)** for the conceptual model.

This README is split into two tiers on purpose: **[What works today](#what-works-today)** is the
shipped surface you can run right now; **[Where this is going](#where-this-is-going)** is the
roadmap — clearly labeled as not-yet-shipped — so the vision above never reads as a promise about
the current build.

<!-- TODO(demo): replace this placeholder with the recorded wow-moment walkthrough
     — Claude Code loading its own sessions through the coach MCP and grading its own
     expensive / hallucinated / wasteful steps (agent self-critique via MCP). -->

> 🎥 **Demo — coming soon.**

Until the video lands, the same moment is written up in text: **[docs/case-study.md](docs/case-study.md)**
walks coach pointed at its author's own ~148 Claude Code sessions, ranking its mistakes by
_preventable cost_ — a worked example that runs entirely on the shipped query surface.

## What works today

The shipped surface is three things: a pure, staged **pipeline**, a React Flow **visualization**,
and a read-only **MCP query server**.

- **Pipeline** (`@coach/pipeline`) — turns trace/log files into a normalized, id-keyed **execution
  graph**, a model that maps 1:1 to a relational DB. Pure and file-system-free; runs in Node and
  the browser alike.
- **Visualization** (`@coach/app`) — a React Flow renderer for a pre-computed execution graph.
- **MCP query server** (`@coach/mcp`) — exposes that graph as a read-only, queryable relational
  surface so an analyst agent drives its own analyses over your sessions.

For the full picture — package layout, pipeline stages, data flow, the MCP query surface, and
deployment — see **[ARCHITECTURE.md](ARCHITECTURE.md)**. It is the living source of truth; this
README only covers getting started.

### Quick start

Requires [pnpm](https://pnpm.io) (do not use npm/yarn) and Node ≥ 20.11.

```bash
pnpm install
pnpm check                       # typecheck + lint + format + test + knip (same as CI)
```

Produce an execution graph from a directory of traces and inspect the per-stage output:

```bash
pnpm e2e <path-or-fixture>       # writes out/<name>/01-classified.json … 06-enriched-graph.json
```

`<path-or-fixture>` is a path relative to cwd, or the name of a fixture under
`packages/pipeline/fixtures/`.

View a graph in the browser:

```bash
pnpm --filter @coach/app dev     # landing page at http://localhost:5173
```

Load a `06-enriched-graph.json` (or any pre-computed graph) via the **"Load pipeline output"**
button, or boot directly from a URL with `?data=<url>`; add `?focus=<nodeId>` to reveal and center
a node.

### Use it from Claude Code (MCP)

Coach ships an MCP server (`@coach/mcp`) that exposes the analyzed execution graph as a read-only,
queryable surface — so the agent can drive its own analyses over your sessions. **Claude Code is
the only supported agent for now.**

**1. Register the server.** Run from anywhere — use the absolute path to this repo so it resolves
regardless of where Claude Code launches the server:

```bash
# preload a dataset (a directory of OTEL trace/log JSON, or native .jsonl sessions)
claude mcp add coach -- node --experimental-strip-types \
  /ABSOLUTE/PATH/TO/coach/packages/mcp/bin/mcp.ts /ABSOLUTE/PATH/TO/traces

# …or omit the directory and load data at runtime via the load_dataset tool
claude mcp add coach -- node --experimental-strip-types \
  /ABSOLUTE/PATH/TO/coach/packages/mcp/bin/mcp.ts
```

The server speaks MCP over stdio. The optional trailing directory is preloaded so the dataset is
queryable immediately; without it, ask the agent to call `load_dataset` with a path first. During
development you can also run it directly with `pnpm mcp [dataset-dir]` from the repo root.

**2. Verify and use it.** In a Claude Code session, run `/mcp` to confirm "coach" is connected,
then ask in plain language — e.g. _"load the traces in ./out and find the most expensive
interactions"_. The server exposes:

| Tool              | What it does                                                   |
| ----------------- | -------------------------------------------------------------- |
| `load_dataset`    | Run the pipeline over a directory and make its graph queryable |
| `describe_schema` | Dump the relational schema + example analysis SQL to extend    |
| `query`           | Run read-only SQL over the execution-graph tables/views        |
| `resolve`         | Resolve a node id to its full record                           |
| `subtree`         | Walk the containment tree under a node                         |
| `causal_path`     | Trace the causal edges leading to/from a node                  |
| `open_viz`        | Open the React Flow graph in the browser, focused on a node    |

To remove it later: `claude mcp remove coach`.

A standalone DuckDB snapshot for ad-hoc inspection in the `duckdb` CLI is also available via
`pnpm build-db <traces-dir> [out.db]` (the MCP itself re-derives from source rather than loading
it).

For a worked analysis built from these tools — failed tool calls ranked by recovery cost, with the
SQL — see **[docs/case-study.md](docs/case-study.md)**.

### Development

| Command                                    | What it does                                          |
| ------------------------------------------ | ----------------------------------------------------- |
| `pnpm check`                               | Full gate: typecheck, lint, format, test, knip        |
| `pnpm lint:fix`                            | Auto-fix lint issues                                  |
| `pnpm format`                              | Auto-format with Prettier                             |
| `pnpm --filter @coach/pipeline test:watch` | Vitest in watch mode                                  |
| `pnpm e2e <fixture>`                       | Run pipeline + deterministic enrichment, write `out/` |
| `pnpm mcp [dataset-dir]`                   | Serve the MCP analyst tools over stdio                |

### Contributing

Branch off `main`, open a PR, and make sure `pnpm check` is green. The full process, code style, and
module conventions live in **[CONTRIBUTING.md](CONTRIBUTING.md)** and **[CLAUDE.md](CLAUDE.md)**.

#### Maintainer one-time setup (requires a GitHub remote)

Make CI a required check so PRs can't merge red:

```bash
gh api -X PUT repos/{owner}/{repo}/branches/main/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=check' \
  -F enforce_admins=true \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F restrictions=
```

## Where this is going

Everything in this section is **roadmap — not yet shipped**. It states design intent, not current
behavior. Today coach targets the **engineer**: you load a dataset and query it. The two threads
below are about whom the findings ultimately serve.

- **Closing the feedback loop back to the agent.** The north star is for the agent to act on its
  own findings, not just for an engineer to read them — Claude Code loading its own sessions and
  correcting its own expensive, hallucinated, or wasteful steps. How that loop is "closed" is still
  undecided, so stage one deliberately targets the engineer until we learn which problems are
  actually solvable.
- **The cross-session per-agent user model (the second pillar).** Because coach holds complete
  sessions and many of them, it aims to infer user **intent in hindsight** and roll it up across
  sessions into a per-agent **user model** — what users want, how they phrase it, what they leave
  unsaid, what needs a clarifying question. This is a separate output with a separate consumer (the
  agent, for personalization); it does not replace the engineer-facing optimization work. The
  conceptual model — and its honest caveats — lives in **[docs/agent-model.md](docs/agent-model.md)**.
