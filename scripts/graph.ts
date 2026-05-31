import { readFileSync, writeFileSync } from 'node:fs';
import type { TraceNode } from '../src/etl/types.ts';
import { traceToCausalMermaid, traceToMermaid } from '../src/graph/mermaid.ts';

const name = process.argv[2];
if (!name) {
  console.error('Usage: pnpm graph <fixture-name>  (e.g. pnpm graph fetch-website)');
  process.exit(1);
}

const outDir = `out/${name}`;

const nodes = JSON.parse(readFileSync(`${outDir}/nodes.json`, 'utf8')) as TraceNode[];

writeFileSync(`${outDir}/composition.mmd`, traceToMermaid(nodes) + '\n');
console.log(`wrote ${outDir}/composition.mmd`);

writeFileSync(`${outDir}/causal.mmd`, traceToCausalMermaid(nodes) + '\n');
console.log(`wrote ${outDir}/causal.mmd`);
