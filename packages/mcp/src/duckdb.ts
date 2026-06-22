// The node-api DuckDB layer. The MCP always re-derives a dataset from its source
// files, so there is one runtime path:
//
//   createDuckDbConnection(graph)  — materialize a graph into a TEMP DB, query, then
//                                    delete it on close (the in-memory load path).
//
// writePersistedDb(graph, dbPath) writes the same materialized tables to a FILE: a
// standalone, queryable DuckDB SQL snapshot (the `coach-build-db` / dump export).
// Coach itself never re-loads it — it's for opening in the duckdb CLI without
// re-running the pipeline — so it carries the query tables only (no embedded graph).
// The query handle is READ_ONLY with external access disabled — the engine is the
// boundary. This is the one node:*-bound piece; the query surface lives in
// ./query-core.ts.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { materializeSql, type ExecutionGraph } from '@coach/pipeline';
import { type Connection } from './query-core.ts';
import type { RawResult } from './result.ts';

// Engine-level read-only sandbox: read-only access, no filesystem/network (COPY,
// read_csv, httpfs, ATTACH, INSTALL), and locked so a query can't re-enable them.
const READ_ONLY_CONFIG: Record<string, string> = {
  access_mode: 'read_only',
  enable_external_access: 'false',
  lock_configuration: 'true',
};

const TMP_PREFIX = 'coach-store-';
const DB_FILE = 'graph.db';

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

/** Materializes a stage-6 graph into a standalone, queryable DuckDB FILE — the
 *  query tables only (no embedded graph). A SQL snapshot for the duckdb CLI; coach
 *  itself re-derives from source rather than re-loading this. */
export async function writePersistedDb(graph: ExecutionGraph, dbPath: string): Promise<void> {
  await buildWritable(dbPath, materializeSql(graph));
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
