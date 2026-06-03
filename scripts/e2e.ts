import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { log } from '@coach/logger';
import {
  addSessionNode,
  aggregateAgent,
  aggregateSession,
  buildAgentCausalGraphView,
  buildCausalGraphView,
  buildSessionCausalGraphView,
  enrichTrace,
  groupSessionsByAgent,
  nativeSessionToTrace,
  transformTrace,
} from '@coach/pipeline';
import type { LogEntry, TempoTrace, TraceNode, UploadedFile, VizData } from '@coach/pipeline';

// ── CLI ───────────────────────────────────────────────────────────────────────

const arg = process.argv[2];
if (!arg) {
  log.error('Usage: pnpm e2e <path>  (e.g. pnpm e2e packages/pipeline/fixtures/fetch-website)');
  process.exit(1);
}

const inputDir = resolve(process.cwd(), arg);
const outDir = `out/${basename(inputDir)}`;
mkdirSync(outDir, { recursive: true });

// ── File helpers ──────────────────────────────────────────────────────────────

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

function writeStage(stageDir: string, stepLabel: string, data: unknown): void {
  mkdirSync(stageDir, { recursive: true });
  const filePath = join(stageDir, `${stepLabel}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  log.info(`  → ${filePath}`);
}

// ── Per-source pipeline (steps 1–3) ──────────────────────────────────────────

interface SourceResult {
  label: string;
  sessionNodes: TraceNode[];
}

function runNativeSource(file: UploadedFile, idx: number): SourceResult {
  const label = `source-${String(idx).padStart(2, '0')}-native`;
  const stageDir = join(outDir, label);
  log.info(`[${label}] native .jsonl`);

  const trace: TempoTrace = nativeSessionToTrace(file.content);
  writeStage(stageDir, '01-tempo-trace', trace);

  const nodes: TraceNode[] = transformTrace(trace);
  writeStage(stageDir, '02-nodes-transformed', nodes);

  const sessionNodes: TraceNode[] = addSessionNode(nodes);
  writeStage(stageDir, '03-nodes-with-session', sessionNodes);

  return { label, sessionNodes };
}

interface OtelBucket {
  dir: string;
  logs: UploadedFile | null;
  traces: UploadedFile[];
}

function runOtelBucket(bucket: OtelBucket, idx: number): SourceResult | null {
  if (bucket.logs == null || bucket.traces.length === 0) return null;

  const label = `source-${String(idx).padStart(2, '0')}-otel-${bucket.dir.replace(/\W+/g, '_') || 'root'}`;
  log.info(`[${label}] OTEL bucket (${String(bucket.traces.length)} trace files)`);

  const logs = JSON.parse(bucket.logs.content) as LogEntry[];
  const perTraceNodes: TraceNode[][] = [];

  const sorted = [...bucket.traces].sort((a, b) => a.name.localeCompare(b.name));
  for (let t = 0; t < sorted.length; t++) {
    const tf = sorted[t];
    if (tf == null) continue;
    const traceLabel = `trace-${String(t).padStart(2, '0')}`;
    const stageDir = join(outDir, label, traceLabel);
    log.info(`  [${traceLabel}] ${tf.name}`);

    const raw = JSON.parse(tf.content) as TempoTrace;
    const enriched: TempoTrace = enrichTrace(raw, logs);
    writeStage(stageDir, '01-enriched-trace', enriched);

    const nodes: TraceNode[] = transformTrace(enriched);
    writeStage(stageDir, '02-nodes-transformed', nodes);

    const sessionNodes: TraceNode[] = addSessionNode(nodes);
    writeStage(stageDir, '03-nodes-with-session', sessionNodes);

    perTraceNodes.push(sessionNodes);
  }

  const sessionNodes: TraceNode[] = aggregateSession(perTraceNodes);
  if (sorted.length > 1) {
    writeStage(join(outDir, label), '04-session-aggregated', sessionNodes);
  }

  return { label, sessionNodes };
}

// ── OTEL file classification ──────────────────────────────────────────────────

function isTraceFile(name: string): boolean {
  return name === 'trace.json' || (name.startsWith('trace-') && name.endsWith('.json'));
}

function dirOf(file: UploadedFile): string {
  const p = file.path ?? file.name;
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '';
}

function buildOtelBuckets(files: readonly UploadedFile[]): Map<string, OtelBucket> {
  const buckets = new Map<string, OtelBucket>();
  for (const file of files) {
    const dir = dirOf(file);
    const bucket = buckets.get(dir) ?? { dir, logs: null, traces: [] };
    if (file.name === 'logs.json') bucket.logs = file;
    else bucket.traces.push(file);
    buckets.set(dir, bucket);
  }
  return buckets;
}

// ── buildVizData (mirrors private orchestrate.ts helper) ─────────────────────

function buildVizData(nodes: readonly TraceNode[]): VizData {
  const agentView = buildAgentCausalGraphView(nodes);
  if (agentView != null) return { kind: 'agent', data: agentView };
  const sessionView = buildSessionCausalGraphView(nodes);
  if (sessionView != null) return { kind: 'session', data: sessionView };
  return { kind: 'interaction', data: buildCausalGraphView(nodes) };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const allFiles = gatherFiles(inputDir, inputDir);
log.info({ files: allFiles.length }, 'gathered input files');

const sourceResults: SourceResult[] = [];
let srcIdx = 0;

// Native .jsonl files
for (const file of allFiles.filter((f) => f.name.endsWith('.jsonl'))) {
  sourceResults.push(runNativeSource(file, srcIdx++));
}

// OTEL buckets
const otelFiles = allFiles.filter((f) => f.name === 'logs.json' || isTraceFile(f.name));
for (const [, bucket] of buildOtelBuckets(otelFiles)) {
  const result = runOtelBucket(bucket, srcIdx++);
  if (result != null) sourceResults.push(result);
}

if (sourceResults.length === 0) {
  log.error('No sources produced results. Check the input files.');
  process.exit(1);
}

// ── Post-aggregation stages (per agent) ──────────────────────────────────────

const agentGroups = groupSessionsByAgent(sourceResults.map((s) => s.sessionNodes));

for (const [agentId, sessionArrays] of agentGroups) {
  const agentLabel = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const agentDir = join(outDir, `agent-${agentLabel}`);
  log.info(`[agent-${agentLabel}] ${String(sessionArrays.length)} session(s)`);

  const sessionNodes: TraceNode[] = aggregateSession(sessionArrays);
  writeStage(agentDir, '04-all-session-nodes', sessionNodes);

  const agentNodes: TraceNode[] = aggregateAgent(sessionNodes);
  writeStage(agentDir, '05-nodes-with-agent', agentNodes);

  const vizData: VizData = buildVizData(agentNodes);
  writeStage(agentDir, '06-vizdata', vizData);
}

log.info(
  `\nTo visualise: pnpm --filter @coach/app dev — then upload the source files from ${inputDir}`,
);
