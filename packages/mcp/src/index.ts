// @coach/mcp — an MCP server that exposes the pipeline's stage-6 execution graph
// as a queryable relational surface, so an analyst agent can drive its own
// analyses (read-only SQL + graph traversal) instead of consuming the fixed
// stage-7 findings. See ARCHITECTURE.md → "MCP query surface".

export { loadDataset } from './load.ts';
export type { Dataset } from './load.ts';
export { dumpPipelineOutputs } from './dump.ts';
export { outputDir } from './output-dir.ts';
export { startVizServer, buildVizUrl } from './viz-server.ts';
export type { VizServer } from './viz-server.ts';
export { createSession } from './session.ts';
export type { DatasetSummary, Session } from './session.ts';
export { createStore } from './store.ts';
export { createTools } from './tools.ts';
export type { Tool } from './tools.ts';
export { createMcpServer, serveStdio } from './server.ts';
export { TABLES } from '@coach/pipeline';
export type { ColumnSpec, TableSpec } from '@coach/pipeline';
export type { CausalDirection, Store } from './query-core.ts';
export type { QueryResult } from './result.ts';
export { EXAMPLE_QUERIES } from './examples.ts';
export type { ExampleQuery } from './examples.ts';
