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

## How it works

Coach runs a pure, staged **pipeline** that turns trace/log files into a normalized, id-keyed
**execution graph** — a model that maps 1:1 to a relational DB. That graph feeds two surfaces: a
React Flow **visualization** (`@coach/app`) and a read-only, queryable **MCP server**
(`@coach/mcp`) an analyst agent drives itself.

For the full picture — package layout, pipeline stages, data flow, the MCP query surface, and
deployment — see **[ARCHITECTURE.md](ARCHITECTURE.md)**. It is the living source of truth; this
README only covers getting started.

## Quick start

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

## Use it from Claude Code (MCP)

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

## Install coach in your own agent

The instructions above run coach from a clone of this repo. To use coach in **your own agent**
without cloning, install the published `@coach/mcp` package — it bundles the pipeline + semantics
into a self-contained server bin (`coach-mcp`) and ships the `analyze-traces` skill so your agent
knows how to drive it. The native DuckDB module and the MCP SDK install as normal npm deps.

```bash
# install the distributable server (once published to npm)
npm install -g @coach/mcp
# …or, from a tarball you built locally:
#   pnpm --filter @coach/mcp build && (cd packages/mcp && npm pack)
#   npm install -g ./coach-mcp-<version>.tgz
```

**1. Install the skill + get the registration line.** `coach-mcp init` copies the bundled
`analyze-traces` skill into your skills dir and prints the exact `claude mcp add` command:

```bash
coach-mcp init                 # installs to ~/.claude/skills/analyze-traces/SKILL.md
coach-mcp init --project       # installs to ./.claude/skills/ instead
coach-mcp init --print-only    # just print the registration line, write nothing
```

It never overwrites an existing skill without `--force`. The command prints:

```text
claude mcp add coach -- coach-mcp
```

**2. Register the server with your agent.** Run that line (append an absolute traces directory to
preload it, e.g. `claude mcp add coach -- coach-mcp /ABS/PATH/TO/traces`). With no directory, the
server defaults to discovering your own Claude Code logs at `~/.claude/projects`, and the agent can
also call `load_dataset` with any path at runtime.

**3. Verify.** In a Claude Code session run `/mcp` to confirm "coach" is connected, then ask
_"analyze my agent traces and find the most expensive interactions"_ — the `analyze-traces` skill
triggers and drives the tools.

> `open_viz` requires the built `@coach/app`, which is not shipped in the server package — querying
> and graph traversal work standalone; the browser visualization is available from a repo clone.

A cross-repo install of the packaged server is exercised end to end by
`node --experimental-strip-types scripts/smoke-mcp-install.ts` (pack → install into a temp dir →
`init` → MCP `tools/list` handshake).

## Development

| Command                                    | What it does                                          |
| ------------------------------------------ | ----------------------------------------------------- |
| `pnpm check`                               | Full gate: typecheck, lint, format, test, knip        |
| `pnpm lint:fix`                            | Auto-fix lint issues                                  |
| `pnpm format`                              | Auto-format with Prettier                             |
| `pnpm --filter @coach/pipeline test:watch` | Vitest in watch mode                                  |
| `pnpm e2e <fixture>`                       | Run pipeline + deterministic enrichment, write `out/` |
| `pnpm mcp [dataset-dir]`                   | Serve the MCP analyst tools over stdio                |

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
