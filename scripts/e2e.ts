import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addSessionNode,
  aggregateAgent,
  aggregateSession,
  groupSessionsByAgent,
} from '../src/etl/aggregate.ts';
import { enrichTrace } from '../src/etl/enrich.ts';
import { nativeSessionToTrace } from '../src/etl/native.ts';
import { transformTrace } from '../src/etl/transform.ts';
import type { LogEntry, TempoTrace, TraceNode } from '../src/etl/types.ts';
import {
  buildAgentCausalGraphView,
  buildCausalGraphView,
  buildSessionCausalGraphView,
} from '../src/graph/view-model.ts';

const arg = process.argv[2];
if (!arg) {
  console.error(
    'Usage: pnpm e2e <path-or-fixture-name>  (e.g. pnpm e2e fetch-website or pnpm e2e src/fixtures)',
  );
  process.exit(1);
}

const resolved = resolve(process.cwd(), arg);
const fixtureDir = existsSync(resolved)
  ? resolved
  : join(import.meta.dirname, '..', 'src', 'fixtures', arg);
const outDir = `out/${basename(fixtureDir)}`;

mkdirSync(outDir, { recursive: true });

const templatePath = resolve(fileURLToPath(import.meta.url), '../../viz/dist/index.html');
let template: string;
try {
  template = readFileSync(templatePath, 'utf8');
} catch {
  console.error('Viz template not found. Build it first:\n  pnpm viz:build');
  process.exit(1);
}

function writeNodes(nodes: readonly TraceNode[], suffix: string): void {
  const path = `${outDir}/nodes${suffix}.json`;
  writeFileSync(path, JSON.stringify(nodes, null, 2) + '\n');
  console.log(`wrote ${path} (${String(nodes.length)} nodes)`);
}

function writeViz(nodes: readonly TraceNode[], suffix: string): void {
  const agentView = buildAgentCausalGraphView(nodes);
  const sessionView = agentView == null ? buildSessionCausalGraphView(nodes) : null;
  const causalView = agentView == null && sessionView == null ? buildCausalGraphView(nodes) : null;
  const vizData =
    agentView != null
      ? { kind: 'agent' as const, data: agentView }
      : sessionView != null
        ? { kind: 'session' as const, data: sessionView }
        : { kind: 'interaction' as const, data: causalView };
  const title = `${basename(outDir)}${suffix}`;
  const injection = `<script>window.__TRACE_DATA__=${JSON.stringify(vizData)};window.__TRACE_TITLE__=${JSON.stringify(title)};</script>`;
  const html = template.replace('</head>', `${injection}</head>`);
  const path = `${outDir}/nodes${suffix}.html`;
  writeFileSync(path, html);
  console.log(`wrote ${path}`);
}

function findJsonlFile(dir: string): string | undefined {
  return readdirSync(dir).find((f) => f.endsWith('.jsonl'));
}

function sortByTime(nodes: readonly TraceNode[]): TraceNode[] {
  return [...nodes].sort((a, b) => {
    if (!a.start_time_ns && !b.start_time_ns) return 0;
    if (!a.start_time_ns) return -1;
    if (!b.start_time_ns) return 1;
    const diff = BigInt(a.start_time_ns) - BigInt(b.start_time_ns);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  });
}

function processNativeFile(jsonlPath: string, suffix: string): TraceNode[] {
  const jsonl = readFileSync(jsonlPath, 'utf8');
  const trace = nativeSessionToTrace(jsonl);
  const traceNodes = sortByTime(addSessionNode(transformTrace(trace)));
  writeNodes(traceNodes, suffix);
  writeViz(traceNodes, suffix);
  return traceNodes;
}

function processTrace(
  dir: string,
  traceLogs: readonly LogEntry[],
  traceFile: string,
  suffix: string,
): TraceNode[] {
  const trace = JSON.parse(readFileSync(join(dir, traceFile), 'utf8')) as TempoTrace;

  const enriched = enrichTrace(trace, traceLogs);
  writeFileSync(`${outDir}/enriched-trace${suffix}.json`, JSON.stringify(enriched, null, 2) + '\n');
  const spanCount = enriched.batches.flatMap((b) => b.scopeSpans.flatMap((ss) => ss.spans)).length;
  console.log(`wrote ${outDir}/enriched-trace${suffix}.json (${String(spanCount)} spans)`);

  const traceNodes = addSessionNode(transformTrace(enriched));
  writeNodes(traceNodes, suffix);
  writeViz(traceNodes, suffix);

  return traceNodes;
}

function processSessionDir(sessionDir: string, sessionName: string): TraceNode[] {
  const jsonlFile = findJsonlFile(sessionDir);
  if (jsonlFile) {
    console.log(`[native] ${sessionName}`);
    return processNativeFile(join(sessionDir, jsonlFile), `-${sessionName}`);
  }

  const sessionLogs = JSON.parse(readFileSync(join(sessionDir, 'logs.json'), 'utf8')) as LogEntry[];

  const traceFiles = readdirSync(sessionDir)
    .filter((f) => f === 'trace.json' || (f.startsWith('trace-') && f.endsWith('.json')))
    .sort();

  if (traceFiles.length === 0) {
    console.error(`No trace file(s) found in ${sessionDir}`);
    return [];
  }

  if (traceFiles.length === 1 && traceFiles[0] != null) {
    return processTrace(sessionDir, sessionLogs, traceFiles[0], `-${sessionName}`);
  }

  const allTraceNodes: TraceNode[][] = [];
  for (const file of traceFiles) {
    const traceId = file.replace(/^trace-/, '').replace(/\.json$/, '');
    console.log(`\n── ${sessionName}/${file}`);
    allTraceNodes.push(processTrace(sessionDir, sessionLogs, file, `-${sessionName}-${traceId}`));
  }

  console.log(`\n── ${sessionName} session`);
  const sessionNodes = aggregateSession(allTraceNodes);
  writeNodes(sessionNodes, `-session-${sessionName}`);
  writeViz(sessionNodes, `-session-${sessionName}`);

  return sessionNodes;
}

function isSessionSubdir(entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) return statSync(join(fixtureDir, entry.name)).isDirectory();
  return false;
}

const entries = readdirSync(fixtureDir, { withFileTypes: true });
const sessionDirNames = entries
  .filter(isSessionSubdir)
  .map((e) => e.name)
  .sort();

const isMultiSession = sessionDirNames.length > 0;

if (isMultiSession) {
  console.log(`multi-session mode: ${String(sessionDirNames.length)} sessions`);

  const allSessionNodes: TraceNode[][] = [];
  for (const sessionName of sessionDirNames) {
    console.log(`\n═══ ${sessionName}`);
    const sessionNodes = processSessionDir(join(fixtureDir, sessionName), sessionName);
    if (sessionNodes.length > 0) allSessionNodes.push(sessionNodes);
  }

  console.log('\n═══ agents');
  const agentGroups = groupSessionsByAgent(allSessionNodes);

  for (const [userId, sessionArrays] of agentGroups) {
    console.log(`\n── agent ${userId}`);
    const mergedNodes = aggregateSession(sessionArrays);
    const agentNodes = aggregateAgent(mergedNodes);
    writeNodes(agentNodes, `-agent-${userId}`);
    writeViz(agentNodes, `-agent-${userId}`);
  }
} else {
  const jsonlFile = findJsonlFile(fixtureDir);
  if (jsonlFile) {
    processNativeFile(join(fixtureDir, jsonlFile), '');
    process.exit(0);
  }

  const logs = JSON.parse(readFileSync(join(fixtureDir, 'logs.json'), 'utf8')) as LogEntry[];

  const traceFiles = readdirSync(fixtureDir)
    .filter((f) => f === 'trace.json' || (f.startsWith('trace-') && f.endsWith('.json')))
    .sort();

  if (traceFiles.length === 0) {
    console.error(`No trace file(s) found in ${fixtureDir}`);
    process.exit(1);
  }

  const isSession = traceFiles.length > 1;

  if (isSession) {
    console.log(`session mode: ${String(traceFiles.length)} traces`);

    const allTraceNodes: TraceNode[][] = [];
    for (const file of traceFiles) {
      const traceId = file.replace(/^trace-/, '').replace(/\.json$/, '');
      console.log(`\n── ${file}`);
      allTraceNodes.push(processTrace(fixtureDir, logs, file, `-${traceId}`));
    }

    console.log('\n── session');
    const sessionNodes = aggregateSession(allTraceNodes);
    writeNodes(sessionNodes, '-session');
    writeViz(sessionNodes, '-session');

    console.log('\n── agent');
    const agentNodes = aggregateAgent(sessionNodes);
    writeNodes(agentNodes, '-agent');
    writeViz(agentNodes, '-agent');
  } else {
    processTrace(fixtureDir, logs, 'trace.json', '');
  }
}
