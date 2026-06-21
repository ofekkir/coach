// The node-api DuckDB layer. Two ways to get a read-only Connection for @coach/store:
//
//   createDuckDbConnection(graph)  — materialize a graph into a TEMP DB, query, then
//                                    delete it on close (the in-memory load path).
//   openPersistedStore(dbPath)     — open a pre-built coach DB FILE untouched (no
//                                    pipeline, no materialize) and query it.
//
// writePersistedDb(graph, dbPath) is the pipeline's shippable artifact: a queryable
// DuckDB that ALSO carries the enriched graph (in `_coach_meta`) so a loader can
// recover it for the graph-shaped tools and the visualization. Either way the query
// handle is READ_ONLY with external access disabled — the engine is the boundary.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import type { ExecutionGraph } from '@coach/pipeline';
import {
  createStore as createCoreStore,
  materializeSql,
  type Connection,
  type RawResult,
  type Store,
} from '@coach/store';

// Engine-level read-only sandbox: read-only access, no filesystem/network (COPY,
// read_csv, httpfs, ATTACH, INSTALL), and locked so a query can't re-enable them.
const READ_ONLY_CONFIG: Record<string, string> = {
  access_mode: 'read_only',
  enable_external_access: 'false',
  lock_configuration: 'true',
};

const TMP_PREFIX = 'coach-store-';
const DB_FILE = 'graph.db';
const META_TABLE = '_coach_meta';

function metaStatements(graph: ExecutionGraph): string[] {
  const json = JSON.stringify(graph).replaceAll("'", "''");
  return [
    `CREATE TABLE ${META_TABLE} (graph JSON)`,
    `INSERT INTO ${META_TABLE} VALUES (CAST('${json}' AS JSON))`,
  ];
}

async function buildWritable(path: string, statements: readonly string[]): Promise<void> {
  const instance = await DuckDBInstance.create(path);
  const conn = await instance.connect();
  for (const statement of statements) await conn.run(statement);
  conn.closeSync();
  instance.closeSync();
}

async function readAll(conn: DuckDBConnection, sql: string): Promise<RawResult> {
  const reader = await conn.runAndReadAll(sql);
  return {
    columns: reader.columnNames(),
    rows: reader.getRowObjectsJson() as unknown as Record<string, unknown>[],
  };
}

async function readGraph(conn: DuckDBConnection): Promise<ExecutionGraph> {
  const { rows } = await readAll(conn, `SELECT graph FROM ${META_TABLE}`);
  const raw = rows[0]?.graph;
  if (raw == null) throw new Error(`not a coach DB — no ${META_TABLE}.graph`);
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as ExecutionGraph;
}

/** Materializes a stage-6 graph into a self-contained, queryable DuckDB FILE that
 *  also carries the graph (in `_coach_meta`). This is the artifact the pipeline
 *  ships; the MCP loads it untouched with `openPersistedStore`. */
export async function writePersistedDb(graph: ExecutionGraph, dbPath: string): Promise<void> {
  await buildWritable(dbPath, [...materializeSql(graph), ...metaStatements(graph)]);
}

/** Builds a TEMP read-only DuckDB from a graph and returns it as a Connection. The
 *  temp DB is removed on close. */
export async function createDuckDbConnection(graph: ExecutionGraph): Promise<Connection> {
  const dir = mkdtempSync(join(tmpdir(), TMP_PREFIX));
  const path = join(dir, DB_FILE);
  await buildWritable(path, materializeSql(graph));
  const instance = await DuckDBInstance.create(path, READ_ONLY_CONFIG);
  const conn = await instance.connect();
  return {
    runAndReadAll: (sql) => readAll(conn, sql),
    close: () => {
      conn.closeSync();
      instance.closeSync();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Opens a pre-built coach DB FILE untouched (read-only, no pipeline) and returns
 *  the query store plus the graph recovered from `_coach_meta`. The file is the
 *  shipped artifact, so close does NOT delete it. */
export async function openPersistedStore(
  dbPath: string,
): Promise<{ store: Store; graph: ExecutionGraph }> {
  const instance = await DuckDBInstance.create(dbPath, READ_ONLY_CONFIG);
  const conn = await instance.connect();
  const graph = await readGraph(conn);
  const connection: Connection = {
    runAndReadAll: (sql) => readAll(conn, sql),
    close: () => {
      conn.closeSync();
      instance.closeSync();
    },
  };
  return { store: createCoreStore(connection), graph };
}
