import { describe, expect, it, vi } from 'vitest';

import type { RawResult } from './result.ts';
import { createStore, type Connection } from './store.ts';

const EMPTY: RawResult = { columns: [], rows: [] };

function fakeConnection(onSql: (sql: string) => RawResult = () => EMPTY): Connection {
  return {
    runAndReadAll: (sql) => Promise.resolve(onSql(sql)),
    close: () => undefined,
  };
}

describe('createStore', () => {
  it('runs a read-only query through the guard and shapes the result', async () => {
    const store = createStore(fakeConnection(() => ({ columns: ['n'], rows: [{ n: 1 }] })));
    const out = await store.query('SELECT 1 AS n');
    expect(out.rows).toEqual([{ n: 1 }]);
    expect(out.rowCount).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it('rejects non-read-only SQL before touching the connection', async () => {
    const run = vi.fn(() => Promise.resolve(EMPTY));
    const store = createStore({ runAndReadAll: run, close: () => undefined });
    await expect(store.query('DROP TABLE nodes')).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('builds a recursive containment query for subtree', async () => {
    let seen = '';
    const store = createStore(
      fakeConnection((sql) => {
        seen = sql;
        return EMPTY;
      }),
    );
    await store.subtree('node-1');
    expect(seen).toContain('containment');
    expect(seen).toContain("'node-1'");
  });

  it('walks the causal edges downstream for causalPath', async () => {
    let seen = '';
    const store = createStore(
      fakeConnection((sql) => {
        seen = sql;
        return EMPTY;
      }),
    );
    await store.causalPath('node-2', 'downstream');
    expect(seen).toContain('causal_edges');
    expect(seen).toContain('from_id = walk.id');
  });

  it('closes the underlying connection', () => {
    const close = vi.fn();
    const store = createStore({ runAndReadAll: () => Promise.resolve(EMPTY), close });
    store.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
