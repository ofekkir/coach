import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPipelineResult } from '@coach/pipeline';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dumpPipelineOutputs } from './dump.ts';

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

  it('writes a queryable .db (tables only, no embedded graph)', async () => {
    const instance = await DuckDBInstance.create(join(outDir, 'graph.db'), {
      access_mode: 'read_only',
    });
    const conn = await instance.connect();
    try {
      const reader = await conn.runAndReadAll('SELECT count(*) AS n FROM nodes');
      const rows = reader.getRowObjectsJson() as unknown as { n: number }[];
      expect(Number(rows[0]?.n)).toBeGreaterThan(0);
    } finally {
      conn.closeSync();
      instance.closeSync();
    }
  });
});
