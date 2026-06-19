// The queryable store: materializes a stage-6 ExecutionGraph into an in-memory
// DuckDB (via `materialize.ts`) and serves read-only SQL plus graph-traversal
// primitives. The graph is already a normalized id-keyed relational model, so the
// load is faithful — no reshaping.

import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import type { ExecutionGraph } from '@coach/pipeline';
import { materializeSql } from './materialize.ts';

/** A query result, fully JSON-safe (lists → arrays, BIGINT → string). Capped so a
 *  broad query can never blow the agent's context; `truncated` says rows were cut. */
export interface QueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number;
  readonly truncated: boolean;
}

export type CausalDirection = 'upstream' | 'downstream';

export interface Store {
  /** Run a read-only SQL query (single SELECT/WITH statement). Throws on anything else. */
  query(sql: string): Promise<QueryResult>;
  /** Containment descendants of a node id, via the `containment` relation. */
  subtree(id: string): Promise<QueryResult>;
  /** Causal ancestors (`upstream`) or descendants (`downstream`) of a node id. */
  causalPath(id: string, direction: CausalDirection): Promise<QueryResult>;
  close(): void;
}

const MAX_ROWS = 1000;

// ── Read-only query guard ────────────────────────────────────────────────────

const READ_ONLY_START = /^(with|select)\b/i;
const FORBIDDEN_KEYWORD =
  /\b(insert|update|delete|drop|create|alter|attach|detach|copy|pragma|call|export|import|install|load|set|truncate|replace|vacuum|checkpoint|reset)\b/i;

function assertReadOnly(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed.length === 0) throw new Error('empty query');
  if (trimmed.includes(';')) throw new Error('only a single statement is allowed (no `;`)');
  if (!READ_ONLY_START.test(trimmed)) throw new Error('only SELECT / WITH queries are allowed');
  if (FORBIDDEN_KEYWORD.test(trimmed))
    throw new Error('write or DDL keywords are not allowed in a read-only query');
  return trimmed;
}

// ── Traversal SQL ────────────────────────────────────────────────────────────

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function subtreeSql(id: string): string {
  const lit = sqlString(id);
  return `WITH RECURSIVE sub(id) AS (
    SELECT ${lit}
    UNION ALL
    SELECT c.child_id FROM containment c JOIN sub ON c.parent_id = sub.id
  )
  SELECT n.id, n.type, n.parent, n.name, n.model, n.duration_ms, n.tool_input, n.prompt
  FROM nodes n JOIN sub ON n.id = sub.id
  WHERE n.id <> ${lit}
  ORDER BY n.start_time_ns`;
}

function causalSql(id: string, direction: CausalDirection): string {
  const lit = sqlString(id);
  const upstream = direction === 'upstream';
  const seed = upstream
    ? `SELECT from_id AS id FROM causal_edges WHERE to_id = ${lit}`
    : `SELECT to_id AS id FROM causal_edges WHERE from_id = ${lit}`;
  const step = upstream
    ? `SELECT e.from_id FROM causal_edges e JOIN walk ON e.to_id = walk.id`
    : `SELECT e.to_id FROM causal_edges e JOIN walk ON e.from_id = walk.id`;
  return `WITH RECURSIVE walk(id) AS (
    ${seed}
    UNION
    ${step}
  )
  SELECT n.id, n.type, n.name, n.model, n.duration_ms
  FROM nodes n JOIN walk ON n.id = walk.id
  ORDER BY n.start_time_ns`;
}

// ── Store factory ────────────────────────────────────────────────────────────

async function loadGraph(conn: DuckDBConnection, graph: ExecutionGraph): Promise<void> {
  for (const statement of materializeSql(graph)) {
    await conn.run(statement);
  }
}

/** Builds an in-memory DuckDB from a stage-6 (enriched) execution graph and
 *  returns the read-only query surface. The DB is rebuilt per dataset; for the
 *  small graphs coach holds this is milliseconds. */
export async function createStore(graph: ExecutionGraph): Promise<Store> {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  await loadGraph(conn, graph);

  async function run(sql: string): Promise<QueryResult> {
    const reader = await conn.runAndReadAll(sql);
    const all = reader.getRowObjectsJson() as unknown as Record<string, unknown>[];
    const truncated = all.length > MAX_ROWS;
    return {
      columns: reader.columnNames(),
      rows: truncated ? all.slice(0, MAX_ROWS) : all,
      rowCount: all.length,
      truncated,
    };
  }

  return {
    query: async (sql) => run(assertReadOnly(sql)),
    subtree: (id) => run(subtreeSql(id)),
    causalPath: (id, direction) => run(causalSql(id, direction)),
    close: () => {
      conn.closeSync();
      instance.closeSync();
    },
  };
}
