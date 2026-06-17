// Canonical conversion (used by CLI scripts)
export { enrichTrace } from './canonical/enrich/enrich.ts';
export { transformTrace } from './canonical/transform/transform.ts';
export { TempoTraceSchema } from './canonical/tempo.schema.ts';
export { agentEntityId, PSEUDO_USER_ID, sessionEntityId } from './types.ts';
export type {
  Agent,
  CanonicalNode,
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
  UserPromptNode,
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

// Findings stage — mechanical derivations over the enriched graph (stage 7).
export { deriveFindings } from './graph/findings/findings.ts';
export type {
  CriticalPath,
  FindingSet,
  Hotspot,
  InteractionFindings,
  NodeRef,
  Repetition,
  Rollup,
  SessionFindings,
  Shape,
} from './graph/findings/types.ts';

// Orchestration
export { buildVizResultFromExecutionGraph, buildVizResults, runPipeline } from './orchestrate.ts';
export type { PipelineResult } from './orchestrate.ts';
