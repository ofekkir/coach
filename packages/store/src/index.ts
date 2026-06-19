// @coach/store — the browser-safe query core shared by the Node MCP and (later) a
// browser/WASM backend. Holds the relational schema specs, the graph→SQL
// materializer, and the backend-neutral Store (read-only guard, capped JSON-safe
// results, graph traversal). The DuckDB engine lives in a backend that implements
// `Connection`; nothing here imports node:* or a database driver.

export { TABLES } from './schema.ts';
export type { ColumnSpec, TableSpec } from './schema.ts';
export { materializeSql } from './materialize.ts';
export { createStore } from './store.ts';
export type { CausalDirection, Connection, Store } from './store.ts';
export type { QueryResult, RawResult } from './result.ts';
