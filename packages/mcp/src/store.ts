// node-api–backed Store. Thin adapter: build the read-only DuckDB connection from a
// stage-6 graph (see ./duckdb.ts), then hand it to the backend-neutral query core
// (./query-core.ts). The engine is the read-only boundary; the core adds the
// analyst surface. The Store/QueryResult/CausalDirection types live in ./query-core.ts.

import type { ExecutionGraph } from '@coach/pipeline';

import { createDuckDbConnection } from './duckdb.ts';
import { createStore as createCoreStore, type Store } from './query-core.ts';

/** Builds a read-only DuckDB-backed Store from a stage-6 (enriched) execution graph.
 *  The DB is rebuilt per dataset; for the small graphs coach holds this is ms. */
export async function createStore(graph: ExecutionGraph): Promise<Store> {
  return createCoreStore(await createDuckDbConnection(graph));
}
