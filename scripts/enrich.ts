import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enrichTrace } from '../src/etl/enrich.ts';
import type { LogEntry, TempoTrace } from '../src/etl/types.ts';

const name = process.argv[2];
if (!name) {
  console.error('Usage: pnpm enrich <fixture-name>  (e.g. pnpm enrich fetch-website)');
  process.exit(1);
}

const fixtureDir = join(import.meta.dirname, '..', 'src', 'fixtures', name);
const outDir = `out/${name}`;

mkdirSync(outDir, { recursive: true });

const trace = JSON.parse(readFileSync(join(fixtureDir, 'trace.json'), 'utf8')) as TempoTrace;
const logs = JSON.parse(readFileSync(join(fixtureDir, 'logs.json'), 'utf8')) as LogEntry[];

const enriched = enrichTrace(trace, logs);

writeFileSync(`${outDir}/enriched-trace.json`, JSON.stringify(enriched, null, 2) + '\n');
console.log(
  `wrote ${outDir}/enriched-trace.json (${String(enriched.batches.flatMap((b) => b.scopeSpans.flatMap((ss) => ss.spans)).length)} spans)`,
);
