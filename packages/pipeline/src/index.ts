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
export type { Hotspot } from './graph/analysis/hotspots.ts';
export type { CriticalPath } from './graph/analysis/critical-path.ts';
export type { Repetition } from './graph/analysis/repetition.ts';

// Orchestration
export { buildVizResultFromExecutionGraph, runPipeline } from './orchestrate.ts';
export type { PipelineResult } from './orchestrate.ts';
