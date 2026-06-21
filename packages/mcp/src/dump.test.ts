import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dumpPipelineOutputs } from './dump.ts';
import { openPersistedStore } from './duckdb.ts';
import { loadPipelineResult } from './load.ts';

const FIXTURE = fileURLToPath(
  new URL('../../pipeline/fixtures/otel/fetch-website', import.meta.url),
);

const EXPECTED_FILES = [
  '01-classified.json',
  '02-sessions.json',
  '03-canonical-by-session.json',
  '04-agent-graph.json',
  '05-execution-graph.json',
  '06-enriched-graph.json',
  '07-analysis.json',
  'graph.db',
];

describe('dumpPipelineOutputs', () => {
  let outDir: string;
  let written: string[];

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'coach-dump-test-'));
    const result = loadPipelineResult(FIXTURE);
    written = await dumpPipelineOutputs(result, outDir);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('writes the expected stage files + .db', () => {
    expect(written.map((p) => basename(p))).toEqual(EXPECTED_FILES);
    for (const file of EXPECTED_FILES) expect(existsSync(join(outDir, file))).toBe(true);
  });

  it('writes a loadable .db carrying the enriched graph', async () => {
    const { store, graph } = await openPersistedStore(join(outDir, 'graph.db'));
    try {
      const nodeCount = Object.keys(graph.nodes).length;
      expect(nodeCount).toBeGreaterThan(0);
      const res = await store.query('SELECT count(*) AS n FROM nodes');
      expect(Number(res.rows[0]?.n)).toBe(nodeCount);
    } finally {
      store.close();
    }
  });
});
