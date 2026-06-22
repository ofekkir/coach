// Backend-neutral query core. Given a `Connection` — a thin port over a SQL engine
// that already enforces read-only at the engine level (see the DuckDB backend in
// `duckdb.ts`) — this builds the analyst-facing `Store`: read-only SQL behind a UX
// guard, graph-traversal primitives, and capped/JSON-safe results.
//
// Pure: no node:* and no database driver import, so the same core serves the Node
// DuckDB backend today and a browser/WASM backend later.

import { assertReadOnly } from './guard.ts';
import { DEFAULT_LIMITS, shapeResult } from './result.ts';
import type { QueryResult, RawResult, ResultLimits } from './result.ts';

/** A SQL engine handle the core drives. The connection OWNS read-only enforcement
 *  (the engine is the boundary); the core only adds a single-statement UX guard. */
export interface Connection {
  /** Run one statement, returning all rows + column names, fully JSON-safe. */
  runAndReadAll(sql: string): Promise<RawResult>;
  close(): void;
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
  ORDER BY n.start_time`;
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
  ORDER BY n.start_time`;
}

// ── Store factory ────────────────────────────────────────────────────────────

/** Wraps a read-only `Connection` in the analyst query surface (guard + caps +
 *  traversal). The connection is responsible for engine-level read-only. */
export function createStore(connection: Connection, limits: ResultLimits = DEFAULT_LIMITS): Store {
  async function run(sql: string): Promise<QueryResult> {
    return shapeResult(await connection.runAndReadAll(sql), limits);
  }
  return {
    query: async (sql) => run(assertReadOnly(sql)),
    subtree: (id) => run(subtreeSql(id)),
    causalPath: (id, direction) => run(causalSql(id, direction)),
    close: () => {
      connection.close();
    },
  };
}
