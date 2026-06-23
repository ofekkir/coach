#!/usr/bin/env node
// Dev entry point. `coach-mcp [dataset-dir]` serves the analyst tools over stdio;
// `coach-mcp init` installs the bundled skill + prints the registration line. The
// real argument parsing lives in `src/cli/cli.ts` (bundled into the published bin);
// this file is the workspace-dev shim run via `node --experimental-strip-types`.
// Diagnostics go to stderr; stdout is the MCP JSON-RPC channel.

import { runCli } from '../src/cli/cli.ts';

const ARGV_USER_START = 2;

runCli(process.argv.slice(ARGV_USER_START)).catch((error: unknown) => {
  process.stderr.write(`coach-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
