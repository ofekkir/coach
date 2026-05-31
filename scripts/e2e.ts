import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addSessionNode, aggregateAgent, aggregateSession } from '../src/etl/aggregate.ts';
import { enrichTrace } from '../src/etl/enrich.ts';
import { transformTrace } from '../src/etl/transform.ts';
import type { LogEntry, TempoTrace, TraceNode } from '../src/etl/types.ts';
import {
  agentToCausalMermaid,
  sessionToCausalMermaid,
  traceToCausalMermaid,
  traceToMermaid,
} from '../src/graph/mermaid.ts';

const name = process.argv[2];
if (!name) {
  console.error('Usage: pnpm e2e <fixture-name>  (e.g. pnpm e2e fetch-website)');
  process.exit(1);
}

const fixtureDir = join(import.meta.dirname, '..', 'src', 'fixtures', name);
const outDir = `out/${name}`;

mkdirSync(outDir, { recursive: true });

const logs = JSON.parse(readFileSync(join(fixtureDir, 'logs.json'), 'utf8')) as LogEntry[];

const traceFiles = readdirSync(fixtureDir)
  .filter((f) => f === 'trace.json' || (f.startsWith('trace-') && f.endsWith('.json')))
  .sort();

if (traceFiles.length === 0) {
  console.error(`No trace file(s) found in ${fixtureDir}`);
  process.exit(1);
}

const isSession = traceFiles.length > 1;

function writeNodes(nodes: readonly TraceNode[], suffix: string): void {
  const path = `${outDir}/nodes${suffix}.json`;
  writeFileSync(path, JSON.stringify(nodes, null, 2) + '\n');
  console.log(`wrote ${path} (${String(nodes.length)} nodes)`);
}

function writeMermaid(nodes: readonly TraceNode[], suffix: string, causal: boolean): void {
  writeFileSync(`${outDir}/composition${suffix}.mmd`, traceToMermaid(nodes) + '\n');
  console.log(`wrote ${outDir}/composition${suffix}.mmd`);
  if (causal) {
    writeFileSync(`${outDir}/causal${suffix}.mmd`, traceToCausalMermaid(nodes) + '\n');
    console.log(`wrote ${outDir}/causal${suffix}.mmd`);
  }
}

function processTrace(traceFile: string, suffix: string): TraceNode[] {
  const trace = JSON.parse(readFileSync(join(fixtureDir, traceFile), 'utf8')) as TempoTrace;

  const enriched = enrichTrace(trace, logs);
  writeFileSync(`${outDir}/enriched-trace${suffix}.json`, JSON.stringify(enriched, null, 2) + '\n');
  const spanCount = enriched.batches.flatMap((b) => b.scopeSpans.flatMap((ss) => ss.spans)).length;
  console.log(`wrote ${outDir}/enriched-trace${suffix}.json (${String(spanCount)} spans)`);

  const traceNodes = addSessionNode(transformTrace(enriched));
  writeNodes(traceNodes, suffix);
  writeMermaid(traceNodes, suffix, true);

  return traceNodes;
}

if (isSession) {
  console.log(`session mode: ${String(traceFiles.length)} traces`);

  const allTraceNodes: TraceNode[][] = [];
  for (const file of traceFiles) {
    const traceId = file.replace(/^trace-/, '').replace(/\.json$/, '');
    console.log(`\n── ${file}`);
    allTraceNodes.push(processTrace(file, `-${traceId}`));
  }

  console.log('\n── session');
  const sessionNodes = aggregateSession(allTraceNodes);
  writeNodes(sessionNodes, '-session');
  writeFileSync(`${outDir}/composition-session.mmd`, traceToMermaid(sessionNodes) + '\n');
  console.log(`wrote ${outDir}/composition-session.mmd`);
  writeFileSync(`${outDir}/causal-session.mmd`, sessionToCausalMermaid(sessionNodes) + '\n');
  console.log(`wrote ${outDir}/causal-session.mmd`);

  console.log('\n── agent');
  const agentNodes = aggregateAgent(sessionNodes);
  writeNodes(agentNodes, '-agent');
  writeFileSync(`${outDir}/composition-agent.mmd`, traceToMermaid(agentNodes) + '\n');
  console.log(`wrote ${outDir}/composition-agent.mmd`);
  writeFileSync(`${outDir}/causal-agent.mmd`, agentToCausalMermaid(agentNodes) + '\n');
  console.log(`wrote ${outDir}/causal-agent.mmd`);
} else {
  processTrace('trace.json', '');
}
