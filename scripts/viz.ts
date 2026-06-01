import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildAgentCausalGraphView,
  buildSessionCausalGraphView,
  buildCausalGraphView,
} from '@coach/pipeline';
import type { TraceNode, VizData } from '@coach/pipeline';

const nodesPath = process.argv[2];
if (!nodesPath) {
  console.error('Usage: pnpm viz <out/fixture/nodes-suffix.json>');
  process.exit(1);
}

const nodes = JSON.parse(readFileSync(nodesPath, 'utf8')) as TraceNode[];
const title = path.basename(nodesPath, '.json');

const agentView = buildAgentCausalGraphView(nodes);
const sessionView = agentView == null ? buildSessionCausalGraphView(nodes) : null;
const interactionView =
  agentView == null && sessionView == null ? buildCausalGraphView(nodes) : null;

const vizData: VizData =
  agentView != null
    ? { kind: 'agent', data: agentView }
    : sessionView != null
      ? { kind: 'session', data: sessionView }
      : { kind: 'interaction', data: interactionView };

const outPath = nodesPath.replace(/\.json$/, '-vizdata.json');
writeFileSync(outPath, JSON.stringify({ title, data: vizData }, null, 2) + '\n');
console.log(`wrote ${outPath}`);
