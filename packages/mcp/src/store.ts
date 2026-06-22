// node-api–backed Store. Thin adapter: build the read-only DuckDB connection from a
// stage-6 graph (see ./duckdb.ts), then hand it to @coach/store's backend-neutral
// core. The engine is the read-only boundary; the core adds the analyst surface.
// The Store/QueryResult/CausalDirection types now live in @coach/store.

import type { ExecutionGraph } from '@coach/pipeline';
import { createStore as createCoreStore, type Store } from '@coach/store';

import { createDuckDbConnection } from './duckdb.ts';

/** Builds a read-only DuckDB-backed Store from a stage-6 (enriched) execution graph.
 *  The DB is rebuilt per dataset; for the small graphs coach holds this is ms. */
export async function createStore(graph: ExecutionGraph): Promise<Store> {
  return createCoreStore(await createDuckDbConnection(graph));
}
