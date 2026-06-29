// Dataset intake for the MCP. The directory→PipelineResult gather lives in
// `@coach/pipeline`'s intake module (shared with the e2e CLI); this file only
// names the MCP's queryable view of one load — the stage-6 enriched graph.

import { loadPipelineResult, type ExecutionGraph } from '@coach/pipeline';

export interface Dataset {
  /** Stage-6 enriched execution graph — the substance the store queries. */
  readonly graph: ExecutionGraph;
}

/** Loads every file under `dir`, runs the full pipeline, and keeps the enriched
 *  graph — the queryable substance. */
export function loadDataset(dir: string): Dataset {
  return { graph: loadPipelineResult(dir).enrichedGraph };
}
