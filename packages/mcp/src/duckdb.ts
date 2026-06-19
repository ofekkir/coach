// The node-api Connection — the read-only DuckDB boundary. Materializes a stage-6
// graph into a temp file-backed DuckDB (writable), then serves queries through a
// READ_ONLY handle with external access disabled and configuration locked, so the
// ENGINE enforces read-only (not a keyword blocklist). The temp DB is removed on
// close. This is the one node:*-bound piece; the query surface lives in @coach/store.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import type { ExecutionGraph } from '@coach/pipeline';
import { materializeSql, type Connection, type RawResult } from '@coach/store';

// Engine-level read-only sandbox: read-only access, no filesystem/network (COPY,
// read_csv, httpfs, ATTACH, INSTALL), and locked so a query can't re-enable them.
const READ_ONLY_CONFIG: Record<string, string> = {
  access_mode: 'read_only',
  enable_external_access: 'false',
  lock_configuration: 'true',
};

const TMP_PREFIX = 'coach-store-';
const DB_FILE = 'graph.db';

async function buildWritable(path: string, graph: ExecutionGraph): Promise<void> {
  const instance = await DuckDBInstance.create(path);
  const conn = await instance.connect();
  for (const statement of materializeSql(graph)) await conn.run(statement);
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

/** Builds the temp read-only DuckDB and returns it as a backend-neutral Connection. */
export async function createDuckDbConnection(graph: ExecutionGraph): Promise<Connection> {
  const dir = mkdtempSync(join(tmpdir(), TMP_PREFIX));
  const path = join(dir, DB_FILE);
  await buildWritable(path, graph);
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
