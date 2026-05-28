import { readFileSync, writeFileSync } from 'node:fs';
import { transformTrace } from '../src/etl/transform.ts';
import type { TempoTrace } from '../src/etl/types.ts';

const trace = JSON.parse(readFileSync('out.enriched-trace.json', 'utf8')) as TempoTrace;
const nodes = transformTrace(trace);

writeFileSync('out.nodes.json', JSON.stringify(nodes, null, 2) + '\n');
console.log(`wrote out.nodes.json (${String(nodes.length)} nodes)`);
