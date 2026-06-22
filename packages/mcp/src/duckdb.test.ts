import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import type { Store } from './query-core.ts';
import { loadDataset } from './load.ts';
import { createStore } from './store.ts';
import { writePersistedDb } from './duckdb.ts';

const FIXTURE = fileURLToPath(
  new URL('../../pipeline/fixtures/otel/fetch-website', import.meta.url),
);

// The MCP always re-derives a dataset from source and queries it through a temp,
// read-only DuckDB built from the graph (createStore). These exercise that path:
// SQL works, the engine is read-only, and the derived VIEWs are valid + agree with
// a direct node aggregate (the equality is by construction, but only if the view
// SQL is correct).
describe('temp-db store built from a graph', () => {
  let store: Store;
  let nodeCount: number;

  beforeAll(async () => {
    const { graph } = loadDataset(FIXTURE);
    nodeCount = Object.keys(graph.nodes).length;
    store = await createStore(graph);
  });

  afterAll(() => {
    store.close();
  });

  it('answers SQL over the materialized tables', async () => {
    const res = await store.query('SELECT count(*) AS n FROM nodes');
    expect(Number(res.rows[0]?.n)).toBe(nodeCount);
  });

  it('keeps the engine read-only', async () => {
    await expect(store.query('DROP TABLE nodes')).rejects.toThrow();
  });

  it('exposes interaction_metrics + transitions as queryable views', async () => {
    const views = await store.query(
      "SELECT table_name FROM information_schema.tables WHERE table_type = 'VIEW' ORDER BY table_name",
    );
    const names = views.rows.map((r) => r.table_name);
    expect(names).toContain('interaction_metrics');
    expect(names).toContain('transitions');
  });

  it('interaction_metrics.tool_count sums to the total tool-node count (no drift)', async () => {
    const res = await store.query(
      "SELECT (SELECT SUM(tool_count) FROM interaction_metrics) AS m, (SELECT COUNT(*) FROM nodes WHERE type = 'tool') AS n",
    );
    expect(Number(res.rows[0]?.m)).toBe(Number(res.rows[0]?.n));
  });

  it('transitions has exactly tool_count−1 rows per interaction', async () => {
    const res = await store.query(
      'SELECT (SELECT COUNT(*) FROM transitions) AS t, ' +
        '(SELECT SUM(CASE WHEN tool_count > 0 THEN tool_count - 1 ELSE 0 END) FROM interaction_metrics) AS expected',
    );
    expect(Number(res.rows[0]?.t)).toBe(Number(res.rows[0]?.expected));
  });

  it('keeps the views read-only too', async () => {
    await expect(store.query('DROP VIEW interaction_metrics')).rejects.toThrow();
  });
});

// writePersistedDb writes a standalone SQL snapshot (the coach-build-db / dump
// export): the query tables only, no embedded graph. Coach never re-loads it, but
// it must be a valid DuckDB another tool can open.
describe('writePersistedDb export (tables only)', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'coach-export-test-'));
    dbPath = join(dir, 'graph.db');
    const { graph } = loadDataset(FIXTURE);
    await writePersistedDb(graph, dbPath);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a real, queryable DB file with the nodes table', async () => {
    expect(statSync(dbPath).size).toBeGreaterThan(0);
    const instance = await DuckDBInstance.create(dbPath, { access_mode: 'read_only' });
    const conn = await instance.connect();
    try {
      const reader = await conn.runAndReadAll('SELECT count(*) AS n FROM nodes');
      const rows = reader.getRowObjectsJson() as unknown as { n: number }[];
      expect(Number(rows[0]?.n)).toBeGreaterThan(0);

      const tables = await conn.runAndReadAll(
        "SELECT table_name FROM information_schema.tables WHERE table_name = '_coach_meta'",
      );
      expect(tables.getRowObjectsJson()).toEqual([]);
    } finally {
      conn.closeSync();
      instance.closeSync();
    }
  });
});
