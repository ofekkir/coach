import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, join, resolve } from 'node:path';
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
  buildAgentCausalHtml,
  buildCausalHtml,
  buildCompositionHtml,
  buildSessionCausalHtml,
} from '../src/graph/html.ts';
import {
  buildAgentCausalGraphView,
  buildCausalGraphView,
  buildCompositionGraphView,
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

function writeNodes(nodes: readonly TraceNode[], suffix: string): void {
  const path = `${outDir}/nodes${suffix}.json`;
  writeFileSync(path, JSON.stringify(nodes, null, 2) + '\n');
  console.log(`wrote ${path} (${String(nodes.length)} nodes)`);
}

function writeHtml(stem: string, html: string): void {
  const path = `${outDir}/${stem}.html`;
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
  writeHtml(
    `composition${suffix}`,
    buildCompositionHtml(buildCompositionGraphView(traceNodes), `Composition${suffix}`),
  );
  const causalView = buildCausalGraphView(traceNodes);
  writeHtml(
    `causal${suffix}`,
    causalView != null ? buildCausalHtml(causalView, `Causal${suffix}`) : '<p>No causal view</p>',
  );
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

  writeHtml(
    `composition${suffix}`,
    buildCompositionHtml(buildCompositionGraphView(traceNodes), `Composition${suffix}`),
  );

  const causalView = buildCausalGraphView(traceNodes);
  writeHtml(
    `causal${suffix}`,
    causalView != null ? buildCausalHtml(causalView, `Causal${suffix}`) : '<p>No causal view</p>',
  );

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

  writeHtml(
    `composition-session-${sessionName}`,
    buildCompositionHtml(buildCompositionGraphView(sessionNodes), `Composition — ${sessionName}`),
  );

  const sessionView = buildSessionCausalGraphView(sessionNodes);
  writeHtml(
    `causal-session-${sessionName}`,
    sessionView != null
      ? buildSessionCausalHtml(sessionView, `Causal — ${sessionName}`)
      : '<p>No session view</p>',
  );

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

    writeHtml(
      `composition-agent-${userId}`,
      buildCompositionHtml(buildCompositionGraphView(agentNodes), `Composition — Agent ${userId}`),
    );

    const agentView = buildAgentCausalGraphView(agentNodes);
    writeHtml(
      `causal-agent-${userId}`,
      agentView != null
        ? buildAgentCausalHtml(agentView, `Causal — Agent ${userId}`)
        : '<p>No agent view</p>',
    );
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

    writeHtml(
      'composition-session',
      buildCompositionHtml(buildCompositionGraphView(sessionNodes), 'Composition — Session'),
    );

    const sessionView = buildSessionCausalGraphView(sessionNodes);
    writeHtml(
      'causal-session',
      sessionView != null
        ? buildSessionCausalHtml(sessionView, 'Causal — Session')
        : '<p>No session view</p>',
    );

    console.log('\n── agent');
    const agentNodes = aggregateAgent(sessionNodes);
    writeNodes(agentNodes, '-agent');

    writeHtml(
      'composition-agent',
      buildCompositionHtml(buildCompositionGraphView(agentNodes), 'Composition — Agent'),
    );

    const agentView = buildAgentCausalGraphView(agentNodes);
    writeHtml(
      'causal-agent',
      agentView != null
        ? buildAgentCausalHtml(agentView, 'Causal — Agent')
        : '<p>No agent view</p>',
    );
  } else {
    processTrace(fixtureDir, logs, 'trace.json', '');
  }
}
