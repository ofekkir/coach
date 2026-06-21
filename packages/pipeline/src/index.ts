// Canonical conversion (used by CLI scripts)
export { enrichTrace } from './canonical/enrich/enrich.ts';
export { transformTrace } from './canonical/transform/transform.ts';
export { TempoTraceSchema } from './canonical/tempo.schema.ts';
export { agentEntityId, PSEUDO_USER_ID, sessionEntityId } from './types.ts';
export type {
  Agent,
  CanonicalNode,
  ErrorKind,
  HookNode,
  InputType,
  InteractionNode,
  LlmRequestNode,
  LogEntry,
  MessageDeltas,
  NodeType,
  OtlpAttribute,
  OtlpBatch,
  OtlpSpan,
  RequestMessage,
  ResponseMessage,
  SemanticFields,
  Session,
  TempoTrace,
  ToolBlockedOnUserNode,
  ToolExecutionNode,
  ToolNode,
  UploadedFile,
} from './types.ts';

// Graph contract — execution graph (normalized, stage-layered, id-keyed)
export type {
  AgentExecution,
  CausalEdge,
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  ResolvedNode,
  SessionExecution,
  Thread,
  VizResult,
} from './graph/types.ts';
export { deltasOf, nodeData, resolve, semanticsOf } from './graph/types.ts';

// Semantic enrichment stage (deterministic; semantic vocabulary supplied by
// @coach/semantics — import config types from there).
export { enrichExecutionGraph } from './graph/semantic/semantic.ts';

// Tool result/error matching (stage 5.5; deterministic, no LLM) — matches each
// tool node to its tool_result by tool_use_id and annotates is_error/error_kind/
// result_summary. Unmatched calls are reported, never dropped.
export { matchToolResults, type ToolResultMatch } from './graph/result/result.ts';

// Analysis stage — mechanical derivations over the enriched graph (stage 7).
// Types live in the module that derives them.
export {
  analyzeGraph,
  type GraphAnalysis,
  type InteractionAnalysis,
  type Rollup,
  type SessionAnalysis,
  type Shape,
} from './graph/analysis/analysis.ts';
export type { FailedFile, Hotspot } from './graph/analysis/hotspots.ts';
export type { CriticalPath } from './graph/analysis/critical-path.ts';
export type { Repetition } from './graph/analysis/repetition.ts';

// Orchestration
export { buildVizResultFromExecutionGraph, runPipeline } from './orchestrate.ts';
export type { PipelineResult } from './orchestrate.ts';

// Graph → DB SQL (the relational schema specs + the graph→SQL materializer). Pure
// string generation; the DuckDB engine that runs it lives in @coach/mcp.
export { materializeSql } from './db/materialize.ts';
export { TABLES } from './db/schema.ts';
export type { ColumnSpec, TableSpec } from './db/schema.ts';
