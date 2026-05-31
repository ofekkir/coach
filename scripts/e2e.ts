import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addSessionNode, aggregateAgent, aggregateSession } from '../src/etl/aggregate.ts';
import { enrichTrace } from '../src/etl/enrich.ts';
import { transformTrace } from '../src/etl/transform.ts';
import type { LogEntry, TempoTrace, TraceNode } from '../src/etl/types.ts';
import {
  buildAgentCausalHtml,
  buildCausalHtml,
  buildCompositionHtml,
  buildSessionCausalHtml,
} from '../src/graph/html.ts';
import {
  agentToCausalMermaid,
  sessionToCausalMermaid,
  traceToCausalMermaid,
  traceToMermaid,
} from '../src/graph/mermaid.ts';
import { buildCausalGraphView, buildCompositionGraphView } from '../src/graph/view-model.ts';

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

function writeDiagram(stem: string, mermaid: string, html: string): void {
  writeFileSync(`${outDir}/${stem}.mmd`, mermaid + '\n');
  console.log(`wrote ${outDir}/${stem}.mmd`);
  writeFileSync(`${outDir}/${stem}.html`, html);
  console.log(`wrote ${outDir}/${stem}.html`);
}

function processTrace(traceFile: string, suffix: string): TraceNode[] {
  const trace = JSON.parse(readFileSync(join(fixtureDir, traceFile), 'utf8')) as TempoTrace;

  const enriched = enrichTrace(trace, logs);
  writeFileSync(`${outDir}/enriched-trace${suffix}.json`, JSON.stringify(enriched, null, 2) + '\n');
  const spanCount = enriched.batches.flatMap((b) => b.scopeSpans.flatMap((ss) => ss.spans)).length;
  console.log(`wrote ${outDir}/enriched-trace${suffix}.json (${String(spanCount)} spans)`);

  const traceNodes = addSessionNode(transformTrace(enriched));
  writeNodes(traceNodes, suffix);

  const compositionView = buildCompositionGraphView(traceNodes);
  writeDiagram(
    `composition${suffix}`,
    traceToMermaid(traceNodes),
    buildCompositionHtml(compositionView, `Composition${suffix}`),
  );

  const causalView = buildCausalGraphView(traceNodes);
  writeDiagram(
    `causal${suffix}`,
    traceToCausalMermaid(traceNodes),
    causalView != null ? buildCausalHtml(causalView, `Causal${suffix}`) : '<p>No causal view</p>',
  );

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

  const sessionCompositionView = buildCompositionGraphView(sessionNodes);
  writeDiagram(
    'composition-session',
    traceToMermaid(sessionNodes),
    buildCompositionHtml(sessionCompositionView, 'Composition — Session'),
  );

  writeDiagram(
    'causal-session',
    sessionToCausalMermaid(sessionNodes),
    buildSessionCausalHtml(sessionNodes, 'Causal — Session'),
  );

  console.log('\n── agent');
  const agentNodes = aggregateAgent(sessionNodes);
  writeNodes(agentNodes, '-agent');

  const agentCompositionView = buildCompositionGraphView(agentNodes);
  writeDiagram(
    'composition-agent',
    traceToMermaid(agentNodes),
    buildCompositionHtml(agentCompositionView, 'Composition — Agent'),
  );

  writeDiagram(
    'causal-agent',
    agentToCausalMermaid(agentNodes),
    buildAgentCausalHtml(agentNodes, 'Causal — Agent'),
  );
} else {
  processTrace('trace.json', '');
}
