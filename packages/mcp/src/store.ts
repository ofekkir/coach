// Why: the DuckDB engine is the read-only boundary; the query core adds the analyst
// surface on top of it. Keeping the boundary in the engine (not the core) means the
// core stays backend-neutral. Store/QueryResult/CausalDirection live in ./query-core.ts.

import type { ExecutionGraph } from '@coach/pipeline';

import { createDuckDbConnection } from './duckdb.ts';
import { createStore as createCoreStore, type Store } from './query-core.ts';

/** Builds a read-only DuckDB-backed Store from a stage-6 (enriched) execution graph.
 *  The DB is rebuilt per dataset; for the small graphs coach holds this is ms. */
export async function createStore(graph: ExecutionGraph): Promise<Store> {
  return createCoreStore(await createDuckDbConnection(graph));
}
