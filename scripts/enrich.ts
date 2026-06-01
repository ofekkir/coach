import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '@coach/logger';
import { enrichTrace } from '@coach/pipeline';
import type { LogEntry, TempoTrace } from '@coach/pipeline';

const name = process.argv[2];
if (!name) {
  log.error('Usage: pnpm enrich <fixture-name>  (e.g. pnpm enrich fetch-website)');
  process.exit(1);
}

const fixtureDir = join(import.meta.dirname, '..', 'packages', 'pipeline', 'fixtures', name);
const outDir = `out/${name}`;

mkdirSync(outDir, { recursive: true });

const trace = JSON.parse(readFileSync(join(fixtureDir, 'trace.json'), 'utf8')) as TempoTrace;
const logs = JSON.parse(readFileSync(join(fixtureDir, 'logs.json'), 'utf8')) as LogEntry[];

const enriched = enrichTrace(trace, logs);
const spanCount = enriched.batches.flatMap((b) => b.scopeSpans.flatMap((ss) => ss.spans)).length;

writeFileSync(`${outDir}/enriched-trace.json`, JSON.stringify(enriched, null, 2) + '\n');
log.info({ spans: spanCount }, `wrote ${outDir}/enriched-trace.json`);
