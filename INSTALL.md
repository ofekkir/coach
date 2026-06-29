# Installing coach as an MCP server

Coach runs as a read-only **stdio MCP server** over Node's type-stripping — **no build
step**. You install it **once per machine**; afterwards any repo's traces are queryable
from Claude Code. **Claude Code is the only supported agent for now.**

**Prereqs:** Node ≥ 22 (for `--experimental-strip-types`), [pnpm](https://pnpm.io)
(do not use npm/yarn), `git`, and a Chromium (system Chrome is fine) for rendering
diagrams. Use **absolute paths** when registering.

Two ways to install — both build from source. In either, you choose whether to **load a
dataset at runtime** (register with no path; ask the agent to call `load_dataset` later)
or **preload a traces directory** now so it's queryable immediately.

## Option 1 — Prompt Claude to install it (quickest)

Paste this into a fresh Claude Code session and let it do the install end to end:

```text
Install the coach MCP server from source on this machine:
1. Clone https://github.com/ofekkir/coach into a stable location and run `pnpm install` in it.
2. Register it with Claude Code over stdio, using the ABSOLUTE path to the clone, with NO
   preloaded dataset (datasets are loaded at runtime):
     claude mcp add coach -- node --experimental-strip-types <ABS_PATH>/packages/mcp/bin/mcp.ts
3. Then tell me to restart Claude Code, and confirm that `coach` appears in `/mcp`.
Use absolute paths throughout and do not preload any repo.
```

The agent reports where it cloned and whether `coach` registered; restart Claude Code
and verify `/mcp` lists it.

## Option 2 — Shell commands

```bash
git clone https://github.com/ofekkir/coach && cd coach && pnpm install

# load data at runtime (recommended) — register with no preloaded dataset
claude mcp add coach -- node --experimental-strip-types \
  "$(pwd)/packages/mcp/bin/mcp.ts"

# …or preload a traces directory so it's queryable immediately
claude mcp add coach -- node --experimental-strip-types \
  "$(pwd)/packages/mcp/bin/mcp.ts" /ABSOLUTE/PATH/TO/traces
```

The optional trailing directory is a folder of OTEL trace/log JSON or native `.jsonl`
sessions. During development you can also run the server directly with
`pnpm mcp [dataset-dir]` from the repo root.

## Verify

Restart Claude Code, run `/mcp`, and confirm **coach** is connected. Remove it later
with `claude mcp remove coach`.
