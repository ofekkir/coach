// Canonical conversion (used by CLI scripts)
export { enrichTrace } from './canonical/enrich/enrich.ts';
export { transformTrace } from './canonical/transform/transform.ts';
export { TempoTraceSchema } from './canonical/tempo.schema.ts';
export type {
  CanonicalNode,
  InputType,
  LogEntry,
  NodeType,
  OtlpAttribute,
  OtlpBatch,
  OtlpSpan,
  TempoTrace,
  UploadedFile,
} from './types.ts';

// Graph contract — execution (mechanical) + semantic (inferred)
export type {
  AgentExecution,
  ExecutionGraph,
  ExecutionNode,
  GraphData,
  GraphEdge,
  InteractionExecution,
  InteractionSemantics,
  InteractionShape,
  Move,
  Segment,
  SemanticGraph,
  SemanticNode,
  SessionExecution,
  Thread,
  VizResult,
} from './graph/types.ts';

// Orchestration
export { buildVizResults, runPipeline } from './orchestrate.ts';
export type { PipelineResult } from './orchestrate.ts';
