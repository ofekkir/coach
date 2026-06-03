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

// View model
export { buildCausalGraphView } from './graph/view-model/graph-view.ts';
export {
  buildAgentCausalGraphView,
  buildSessionCausalGraphView,
} from './graph/view-model/session-view.ts';
export type {
  ActionStepView,
  AgentCausalGraphView,
  CausalGraphView,
  GraphViewEdge,
  GraphViewNode,
  GraphViewThread,
  InferenceStepView,
  InteractionShape,
  Move,
  SegmentView,
  SessionCausalGraphView,
  StepView,
  VizData,
} from './graph/view-model/types.ts';

// Orchestration
export { buildVizResults, runPipeline } from './orchestrate.ts';
export type { PipelineResult, VizResult } from './orchestrate.ts';
