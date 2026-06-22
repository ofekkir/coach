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

// Why: semantic vocabulary is owned by @coach/semantics — config types are
// imported from there, not re-exported here, to keep the source of truth single.
export { enrichExecutionGraph } from './graph/semantic/semantic.ts';

export { buildVizResultFromExecutionGraph, runPipeline } from './orchestrate.ts';
export type { PipelineResult } from './orchestrate.ts';

// Why: this emits SQL as pure strings only — the DuckDB engine that executes it
// lives in @coach/mcp, keeping this package free of a runtime DB dependency.
export { materializeSql } from './db/materialize.ts';
export { TABLES } from './db/schema.ts';
export type { ColumnSpec, TableSpec } from './db/spec.ts';
