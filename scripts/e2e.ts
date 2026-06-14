import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { log } from '@coach/logger';
import { enrichExecutionGraph, runPipeline } from '@coach/pipeline';
import type { UploadedFile } from '@coach/pipeline';
import { defaultSemanticsConfig } from '@coach/semantics';

// ── CLI ───────────────────────────────────────────────────────────────────────

// argv[0]=node, argv[1]=script — user args start after them.
const ARGV_USER_START = 2;
const JSON_INDENT = 2;

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
mkdirSync(outDir, { recursive: true });

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

function dump(stepLabel: string, data: unknown): void {
  const filePath = join(outDir, `${stepLabel}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, JSON_INDENT) + '\n');
  log.info(`  → ${filePath}`);
}

const files = gatherFiles(inputDir, inputDir);
log.info({ files: files.length }, 'gathered input files');

const result = runPipeline(files);
// Stage 6 — semantic enrichment is deterministic; the labels come entirely from
// the bundled SemanticsConfig (no model).
const enrichedGraph = enrichExecutionGraph(result.executionGraph, defaultSemanticsConfig);

// Input-bearing members are projected to names/types so the dumps stay readable;
// the graph members are dumped in full — they are the point of inspection.
dump(
  '01-classified',
  result.classified.map((c) => ({ name: c.file.name, path: c.file.path, type: c.type })),
);
dump(
  '02-sessions',
  result.sessions.map((s) => ({
    sessionId: s.sessionId,
    kind: s.kind,
    inputs: s.inputs.map((i) => i.file.name),
  })),
);
dump('03-canonical-by-session', result.canonicalBySession);
dump('04-agent-graph', result.agentGraph);
dump('05-execution-graph', result.executionGraph);
dump('06-enriched-graph', { executionGraph: enrichedGraph });

const unsupported = result.classified.filter((c) => c.type === 'unsupported');
if (unsupported.length > 0) {
  log.warn({ files: unsupported.map((u) => u.file.name) }, 'unsupported inputs ignored');
}
log.info(
  { sessions: result.sessions.length, agentGraphNodes: result.agentGraph.length },
  `done → ${outDir}`,
);
log.info(`To visualize: pnpm --filter @coach/app dev  (then upload the files from ${outDir})`);
