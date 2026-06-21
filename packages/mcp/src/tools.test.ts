import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GraphAnalysis, ResolvedNode } from '@coach/pipeline';
import type { QueryResult } from './result.ts';
import { createSession, type Session } from './session.ts';
import { createTools, type Tool } from './tools.ts';

const FIXTURE = fileURLToPath(
  new URL('../../pipeline/fixtures/otel/fetch-website', import.meta.url),
);

describe('createTools', () => {
  let session: Session;
  let tools: Tool[];

  const tool = (name: string): Tool => {
    const match = tools.find((t) => t.name === name);
    if (match == null) throw new Error(`no tool '${name}'`);
    return match;
  };

  beforeAll(async () => {
    session = createSession();
    tools = createTools(session);
    await tool('load_dataset').handle({ path: FIXTURE });
  });

  afterAll(() => {
    session.close();
  });

  it('exposes the seven analyst tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'causal_path',
      'describe_schema',
      'get_analysis',
      'load_dataset',
      'query',
      'resolve',
      'subtree',
    ]);
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

  it('get_analysis returns the curated stage-7 analysis', async () => {
    const analysis = (await tool('get_analysis').handle({})) as GraphAnalysis;
    expect(analysis.sessions.length).toBeGreaterThan(0);
  });
});
