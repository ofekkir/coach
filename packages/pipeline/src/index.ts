// Canonical conversion (used by CLI scripts)
export { enrichTrace } from './canonical/enrich/enrich.ts';
export { transformTrace } from './canonical/transform/transform.ts';
export { TempoTraceSchema } from './canonical/tempo.schema.ts';
export { PSEUDO_USER_ID } from './types.ts';
export type {
  ActionNode,
  AgentNode,
  CanonicalNode,
  GraphNode,
  HookNode,
  InferenceNode,
  InputType,
  InteractionNode,
  LlmRequestNode,
  LogEntry,
  NodeType,
  OtlpAttribute,
  OtlpBatch,
  OtlpSpan,
  RequestMessage,
  ResponseMessage,
  SemanticNode,
  SessionNode,
  TempoTrace,
  ToolBlockedOnUserNode,
  ToolExecutionNode,
  ToolNode,
  UploadedFile,
  UserPromptNode,
} from './types.ts';

// Graph contract — execution graph (mechanical skeleton)
export type {
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  GraphEdge,
  InteractionExecution,
  SessionExecution,
  Thread,
  VizResult,
} from './graph/types.ts';

// Semantic enrichment stage (opt-in; LLM adapter injected by caller, semantic
// vocabulary supplied by @coach/semantics — import config types from there).
export { enrichExecutionGraph } from './graph/semantic/semantic.ts';
export type { LabelBatchFn, LabelRequest } from './graph/semantic/semantic.ts';

// Orchestration
export {
  buildVizResultFromExecutionGraph,
  buildVizResults,
  runPipeline,
  runPipelineAsync,
} from './orchestrate.ts';
export type { PipelineResult } from './orchestrate.ts';
