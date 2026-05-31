import { readFileSync, writeFileSync } from 'node:fs';
import { transformTrace } from '../src/etl/transform.ts';
import type { TempoTrace } from '../src/etl/types.ts';

const name = process.argv[2];
if (!name) {
  console.error('Usage: pnpm etl <fixture-name>  (e.g. pnpm etl fetch-website)');
  process.exit(1);
}

const outDir = `out/${name}`;

const trace = JSON.parse(readFileSync(`${outDir}/enriched-trace.json`, 'utf8')) as TempoTrace;
const nodes = transformTrace(trace);

writeFileSync(`${outDir}/nodes.json`, JSON.stringify(nodes, null, 2) + '\n');
console.log(`wrote ${outDir}/nodes.json (${String(nodes.length)} nodes)`);
