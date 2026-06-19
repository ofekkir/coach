#!/usr/bin/env -S node --experimental-strip-types
// Entry point: `coach-mcp [dataset-dir]` serves the analyst tools over stdio. An
// optional directory is preloaded through the pipeline; otherwise the agent loads
// data at runtime via the `load_dataset` tool. Diagnostics go to stderr only —
// stdout is the MCP JSON-RPC channel.

import { serveStdio } from '../src/server.ts';

const ARGV_USER_START = 2;
const dir = process.argv[ARGV_USER_START];

serveStdio(dir).catch((error: unknown) => {
  process.stderr.write(`coach-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
