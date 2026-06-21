import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Store } from '@coach/store';
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
});
