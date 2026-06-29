import { basename } from 'node:path';

import { log } from '@coach/logger';
import { dumpPipelineOutputs } from '@coach/mcp';
import { loadFromSource, type LoadedDataset } from '@coach/pipeline';

// ── CLI ───────────────────────────────────────────────────────────────────────

// argv[0]=node, argv[1]=script — user args start after them.
const ARGV_USER_START = 2;

const cliArgs = process.argv.slice(ARGV_USER_START);
const debugFlag = cliArgs.includes('--debug');
const positionals = cliArgs.filter((a) => !a.startsWith('--'));
const arg = positionals[0];

if (debugFlag) log.level = 'debug';

if (!arg) {
  log.error(
    'Usage: pnpm e2e <dir | repo-name> [--debug]\n' +
      '  dir       a directory of OTEL/native files (e.g. packages/pipeline/fixtures/otel/fetch-website)\n' +
      "  repo-name a repo (e.g. 'coach') — loads its Claude Code logs across the main checkout + all worktrees",
  );
  process.exit(1);
}

// ── Load (the same convenience the MCP's `load_dataset` exposes) ────────────────

// An existing directory loads literally; any other string resolves as a repo name
// to the main checkout + every worktree — both run through the full pipeline.
function load(source: string): LoadedDataset {
  try {
    return loadFromSource(source);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}

const { dirs, result } = load(arg);
log.info({ dirs: dirs.length, paths: dirs }, 'loaded source directories');

// ── Dump each stage member ──────────────────────────────────────────────────────

const outDir = `out/${basename(arg)}`;

// Shared with the MCP's directory load: writes 01..06 JSON + the self-contained .db.
const written = await dumpPipelineOutputs(result, outDir);
for (const path of written) log.info(`  → ${path}`);

// A repo load sweeps in every sidecar file (`.meta.json`, `.txt`, …); the
// classifier ignores them. Summarize rather than dumping the whole list.
const UNSUPPORTED_SAMPLE = 5;
const unsupported = result.classified.filter((c) => c.type === 'unsupported');
if (unsupported.length > 0) {
  log.warn(
    {
      count: unsupported.length,
      sample: unsupported.slice(0, UNSUPPORTED_SAMPLE).map((u) => u.file.name),
    },
    'unsupported inputs ignored',
  );
}
log.info(
  { sessions: result.sessions.length, agentGraphNodes: result.agentGraph.nodes.length },
  `done → ${outDir}`,
);
log.info(`To visualize: pnpm --filter @coach/app dev  (then upload the files from ${outDir})`);
