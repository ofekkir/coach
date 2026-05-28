import { readFileSync, writeFileSync } from 'node:fs';
import type { TraceNode } from '../src/etl/types.ts';
import { traceToMermaid } from '../src/graph/mermaid.ts';

const nodes = JSON.parse(readFileSync('out.nodes.json', 'utf8')) as TraceNode[];

writeFileSync('out.mmd', traceToMermaid(nodes) + '\n');
console.log('wrote out.mmd');
