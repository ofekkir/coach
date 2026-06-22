#!/usr/bin/env -S node --experimental-strip-types
// Why: stdout is reserved for the MCP JSON-RPC channel, so all diagnostics
// must go to stderr only.

import { serveStdio } from '../src/server.ts';

const ARGV_USER_START = 2;
const dir = process.argv[ARGV_USER_START];

serveStdio(dir).catch((error: unknown) => {
  process.stderr.write(`coach-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
