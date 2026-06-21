import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { log } from '@coach/logger';
import { runPipeline } from '@coach/pipeline';
import type { UploadedFile } from '@coach/pipeline';
import { dumpPipelineOutputs } from '@coach/mcp';

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
    'Usage: pnpm e2e <path> [--debug]  (e.g. pnpm e2e packages/pipeline/fixtures/otel/fetch-website)',
  );
  process.exit(1);
}

function resolveInput(a: string): string {
  const direct = resolve(process.cwd(), a);
  if (existsSync(direct)) return direct;
  log.error(`Input not found: '${direct}'`);
  process.exit(1);
}

const inputDir = resolveInput(arg);
const outDir = `out/${basename(inputDir)}`;

// ── Gather files (the same flat UploadedFile[] the browser upload produces) ─────

function gatherFiles(dir: string, rootDir: string): UploadedFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return gatherFiles(fullPath, rootDir);
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.jsonl') && !lower.endsWith('.json')) return [];
    const rel = fullPath.startsWith(rootDir + '/')
      ? fullPath.slice(rootDir.length + 1)
      : entry.name;
    return [{ name: entry.name, content: readFileSync(fullPath, 'utf8'), path: rel }];
  });
}

// ── Run the pipeline and dump each stage member ────────────────────────────────

const files = gatherFiles(inputDir, inputDir);
log.info({ files: files.length }, 'gathered input files');

// runPipeline runs all seven stages, including deterministic enrichment + analysis.
const result = runPipeline(files);

// Shared with the MCP's directory load: writes 01..07 JSON + the self-contained .db.
const written = await dumpPipelineOutputs(result, outDir);
for (const path of written) log.info(`  → ${path}`);

const unsupported = result.classified.filter((c) => c.type === 'unsupported');
if (unsupported.length > 0) {
  log.warn({ files: unsupported.map((u) => u.file.name) }, 'unsupported inputs ignored');
}
log.info(
  { sessions: result.sessions.length, agentGraphNodes: result.agentGraph.nodes.length },
  `done → ${outDir}`,
);
log.info(`To visualize: pnpm --filter @coach/app dev  (then upload the files from ${outDir})`);
