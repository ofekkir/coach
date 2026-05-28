import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enrichTrace } from '../src/etl/enrich.ts';
import type { LogEntry, TempoTrace } from '../src/etl/types.ts';

const fixturesDir = join(import.meta.dirname, '..', 'src', 'fixtures');
const traceId = '787ceebc8510eea59c08cea073a1dd2';

const trace = JSON.parse(
  readFileSync(join(fixturesDir, `trace-${traceId}.json`), 'utf8'),
) as TempoTrace;

const logs = JSON.parse(
  readFileSync(join(fixturesDir, `logs-${traceId}.json`), 'utf8'),
) as LogEntry[];

const enriched = enrichTrace(trace, logs);

writeFileSync('out.enriched-trace.json', JSON.stringify(enriched, null, 2) + '\n');
console.log(
  `wrote out.enriched-trace.json (${String(enriched.batches.flatMap((b) => b.scopeSpans.flatMap((ss) => ss.spans)).length)} spans)`,
);
