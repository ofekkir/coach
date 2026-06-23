import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import type { ResolvedNode } from '@coach/pipeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStore, type Store } from './query-core.ts';
import type { QueryResult, RawResult } from './result.ts';
import type { Session } from './session.ts';
import { createSession } from './session.ts';
import { createTools, type Tool } from './tools.ts';

const FIXTURE = fileURLToPath(
  new URL('../../pipeline/fixtures/otel/fetch-website', import.meta.url),
);

describe('createTools', () => {
  let session: Session;
  let tools: Tool[];
  // A directory load dumps stage outputs into the cwd — run from a temp dir so the
  // repo working tree stays clean.
  let cwdBefore: string;
  let tmpCwd: string;

  const tool = (name: string): Tool => {
    const match = tools.find((t) => t.name === name);
    if (match == null) throw new Error(`no tool '${name}'`);
    return match;
  };

  beforeAll(async () => {
    cwdBefore = process.cwd();
    tmpCwd = mkdtempSync(`${tmpdir()}/coach-tools-test-`);
    process.chdir(tmpCwd);
    session = createSession();
    tools = createTools(session);
    await tool('load_dataset').handle({ path: FIXTURE });
  });

  afterAll(() => {
    session.close();
    process.chdir(cwdBefore);
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('exposes the seven analyst tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'causal_path',
      'describe_schema',
      'load_dataset',
      'open_viz',
      'query',
      'resolve',
      'subtree',
    ]);
  });

  it('load_dataset on a directory reports the dumped stage files', async () => {
    const summary = (await tool('load_dataset').handle({ path: FIXTURE })) as {
      dumped?: string[];
    };
    expect(summary.dumped?.some((p) => p.endsWith('06-enriched-graph.json'))).toBe(true);
    expect(summary.dumped?.some((p) => p.endsWith('graph.db'))).toBe(true);
  });

  it('load_dataset summarizes the loaded graph', async () => {
    const summary = (await tool('load_dataset').handle({ path: FIXTURE })) as {
      nodes: number;
      sessions: number;
    };
    expect(summary.nodes).toBeGreaterThan(0);
    expect(summary.sessions).toBeGreaterThan(0);
  });

  it('querying before any dataset is loaded fails with a clear message', async () => {
    const fresh = createTools(createSession());
    const query = fresh.find((t) => t.name === 'query');
    await expect((async () => query?.handle({ sql: 'SELECT 1' }))()).rejects.toThrow(
      /load_dataset/,
    );
  });

  it('describe_schema lists the tables and the vocabulary', async () => {
    const schema = (await tool('describe_schema').handle({})) as {
      tables: unknown[];
      vocabulary: unknown;
    };
    expect(schema.tables.length).toBeGreaterThan(0);
    expect(schema.vocabulary).toBeDefined();
  });

  it('query runs read-only SQL over the graph', async () => {
    const result = (await tool('query').handle({
      sql: 'SELECT count(*) AS n FROM nodes',
    })) as QueryResult;
    expect(Number(result.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('resolve hydrates a node across layers', async () => {
    const ids = (await tool('query').handle({
      sql: 'SELECT id FROM nodes LIMIT 1',
    })) as QueryResult;
    const id = ids.rows[0]?.id;
    const resolved = (await tool('resolve').handle({ id })) as ResolvedNode;
    expect(resolved.node.id).toBe(id);
  });
});

// Stand-in session whose store applies tiny limits over a fixed result, so a
// truncated query is deterministic and fast — no heavy fixture / DuckDB needed.
function fakeSession(store: Store): Session {
  const unused = (): never => {
    throw new Error('not used in this test');
  };
  return {
    load: () => Promise.reject(new Error('not used in this test')),
    dataset: unused,
    store: () => store,
    close: () => undefined,
  };
}

describe('query tool serialization round-trip', () => {
  const JSON_INDENT = 2;

  it('keeps notice and droppedRows when the result is serialized back to the caller', async () => {
    const big = 'a'.repeat(500);
    const raw: RawResult = {
      columns: ['x'],
      rows: Array.from({ length: 100 }, () => ({ x: big })),
    };
    const store = createStore(
      { runAndReadAll: () => Promise.resolve(raw), close: () => undefined },
      { maxRows: 1000, maxBytes: 1000, maxCellChars: 10_000 },
    );
    const query = createTools(fakeSession(store)).find((t) => t.name === 'query');
    if (query == null) throw new Error('no query tool');

    const result = (await query.handle({ sql: 'SELECT x FROM t' })) as QueryResult;
    expect(result.droppedRows).toBeGreaterThan(0);
    expect(result.notice).toBeDefined();

    // Mirror server.ts textResult: the payload the caller actually receives.
    const serialized = JSON.parse(JSON.stringify(result, null, JSON_INDENT)) as QueryResult;
    expect(serialized.droppedRows).toBe(result.droppedRows);
    expect(serialized.returnedRows).toBe(result.returnedRows);
    expect(serialized.truncated).toBe(true);
    expect(serialized.notice).toBe(result.notice);
    expect(serialized.notice).toContain('serialized-byte budget');
    expect(serialized.notice).toContain(`${String(serialized.droppedRows)} of 100 rows`);
  });
});
