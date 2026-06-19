import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDataset } from './load.ts';
import { createStore, type Store } from './store.ts';

const FIXTURE = fileURLToPath(
  new URL('../../pipeline/fixtures/otel/fetch-website', import.meta.url),
);

describe('createStore', () => {
  let store: Store;

  beforeAll(async () => {
    store = await createStore(loadDataset(FIXTURE).graph);
  });

  afterAll(() => {
    store.close();
  });

  it('loads the node table and answers SQL', async () => {
    const result = await store.query('SELECT count(*) AS n FROM nodes');
    expect(Number(result.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('exposes the type-specific columns for aggregation', async () => {
    const result = await store.query(
      "SELECT count(*) AS llm_calls FROM nodes WHERE type = 'llm_request'",
    );
    expect(Number(result.rows[0]?.llm_calls)).toBeGreaterThan(0);
  });

  it('runs the redundant-tool detector as plain SQL (the stage-7 pattern)', async () => {
    const result = await store.query(`
      SELECT interaction_id, name, tool_input, count(*) AS occurrences
      FROM nodes WHERE type = 'tool'
      GROUP BY interaction_id, name, tool_input
      HAVING count(*) >= 2`);
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it('reaches un-promoted fields through the JSON escape hatch', async () => {
    const result = await store.query(
      "SELECT json_extract_string(data, '$.type') AS t FROM nodes LIMIT 1",
    );
    expect(typeof result.rows[0]?.t).toBe('string');
  });

  it('walks the containment subtree of an interaction', async () => {
    const root = await store.query("SELECT id FROM nodes WHERE type = 'interaction' LIMIT 1");
    const interactionId = String(root.rows[0]?.id);
    const sub = await store.subtree(interactionId);
    expect(sub.rowCount).toBeGreaterThan(0);
  });

  it('walks the causal path downstream of a node', async () => {
    const seed = await store.query('SELECT from_id FROM causal_edges LIMIT 1');
    const fromId = String(seed.rows[0]?.from_id);
    const downstream = await store.causalPath(fromId, 'downstream');
    expect(downstream.rowCount).toBeGreaterThan(0);
  });

  it('rejects writes and DDL', async () => {
    await expect(store.query('DROP TABLE nodes')).rejects.toThrow();
    await expect(store.query('DELETE FROM nodes')).rejects.toThrow();
    await expect(store.query('SELECT 1; SELECT 2')).rejects.toThrow();
  });
});
