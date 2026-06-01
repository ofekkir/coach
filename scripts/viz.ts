import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { TraceNode } from '../src/etl/types.ts';
import {
  buildAgentCausalGraphView,
  buildSessionCausalGraphView,
  buildCausalGraphView,
} from '../src/graph/view-model.ts';

const nodesPath = process.argv[2];
if (!nodesPath) {
  console.error('Usage: pnpm viz <out/fixture/nodes-suffix.json>');
  process.exit(1);
}

const templatePath = path.resolve(fileURLToPath(import.meta.url), '../../viz/dist/index.html');

let template: string;
try {
  template = readFileSync(templatePath, 'utf8');
} catch {
  console.error('Viz template not found. Build it first:\n  pnpm viz:build');
  process.exit(1);
}

const nodes = JSON.parse(readFileSync(nodesPath, 'utf8')) as TraceNode[];
const title = path.basename(nodesPath, '.json');

const agentView = buildAgentCausalGraphView(nodes);
const sessionView = agentView == null ? buildSessionCausalGraphView(nodes) : null;
const interactionView =
  agentView == null && sessionView == null ? buildCausalGraphView(nodes) : null;

type VizData =
  | { kind: 'agent'; data: ReturnType<typeof buildAgentCausalGraphView> }
  | { kind: 'session'; data: ReturnType<typeof buildSessionCausalGraphView> }
  | { kind: 'interaction'; data: ReturnType<typeof buildCausalGraphView> };

const vizData: VizData =
  agentView != null
    ? { kind: 'agent', data: agentView }
    : sessionView != null
      ? { kind: 'session', data: sessionView }
      : { kind: 'interaction', data: interactionView };

const injection = `<script>window.__TRACE_DATA__=${JSON.stringify(vizData)};window.__TRACE_TITLE__=${JSON.stringify(title)};</script>`;
const html = template.replace('</head>', `${injection}</head>`);

const outPath = nodesPath.replace(/\.json$/, '.html');
writeFileSync(outPath, html);
console.log(`wrote ${outPath}`);
