import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Store } from './query-core.ts';
import { loadDataset } from './load.ts';
import { openPersistedStore, writePersistedDb } from './duckdb.ts';

const FIXTURE = fileURLToPath(
  new URL('../../pipeline/fixtures/otel/fetch-website', import.meta.url),
);

// Proves the lean flow: the pipeline writes a self-contained DB, and the MCP opens
// it UNTOUCHED (no pipeline) to query it and to recover the graph for the viz.
describe('persisted DB (pipeline ships it, MCP loads it untouched)', () => {
  let dir: string;
  let dbPath: string;
  let store: Store;
  let nodeCount: number;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'coach-db-test-'));
    dbPath = join(dir, 'graph.db');
    const { graph } = loadDataset(FIXTURE);
    nodeCount = Object.keys(graph.nodes).length;
    await writePersistedDb(graph, dbPath);
    const opened = await openPersistedStore(dbPath);
    store = opened.store;
    // The graph is recovered from the DB itself (for the graph tools + viz).
    expect(Object.keys(opened.graph.nodes).length).toBe(nodeCount);
  });

  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a real DB file on disk', () => {
    expect(statSync(dbPath).size).toBeGreaterThan(0);
  });

  it('answers SQL from the pre-built DB without re-running the pipeline', async () => {
    const res = await store.query('SELECT count(*) AS n FROM nodes');
    expect(Number(res.rows[0]?.n)).toBe(nodeCount);
  });

  it('keeps the loaded DB read-only', async () => {
    await expect(store.query('DROP TABLE nodes')).rejects.toThrow();
  });

  // interaction_metrics + transitions are VIEWs over `nodes` (computed on read).
  // These prove the view SQL is valid AND that it agrees with a direct aggregate —
  // the equality is by construction, but only if the SELECT bodies are correct.
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
