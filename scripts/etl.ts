import { readFileSync, writeFileSync } from 'node:fs';
import { log } from '@coach/logger';
import { transformTrace } from '@coach/pipeline';
import type { TempoTrace } from '@coach/pipeline';

const name = process.argv[2];
if (!name) {
  log.error('Usage: pnpm etl <fixture-name>  (e.g. pnpm etl fetch-website)');
  process.exit(1);
}

const outDir = `out/${name}`;

const trace = JSON.parse(readFileSync(`${outDir}/enriched-trace.json`, 'utf8')) as TempoTrace;
const nodes = transformTrace(trace);

writeFileSync(`${outDir}/nodes.json`, JSON.stringify(nodes, null, 2) + '\n');
log.info({ nodes: nodes.length }, `wrote ${outDir}/nodes.json`);
