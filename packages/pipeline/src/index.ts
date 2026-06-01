// ETL
export {
  addSessionNode,
  aggregateAgent,
  aggregateSession,
  groupSessionsByAgent,
} from './etl/aggregate.ts';
export { enrichTrace } from './etl/enrich.ts';
export { nativeSessionToTrace } from './etl/native.ts';
export { TempoTraceSchema } from './etl/tempo.schema.ts';
export { transformTrace } from './etl/transform.ts';
export type {
  LogEntry,
  NodeType,
  OtlpAttribute,
  OtlpBatch,
  OtlpSpan,
  TempoTrace,
  TraceNode,
} from './etl/types.ts';

// View model
export {
  buildAgentCausalGraphView,
  buildCausalGraphView,
  buildSessionCausalGraphView,
} from './graph/view-model.ts';
export type {
  AgentCausalGraphView,
  CausalGraphView,
  GraphViewEdge,
  GraphViewNode,
  GraphViewThread,
  SessionCausalGraphView,
  VizData,
} from './graph/view-model.ts';

// Orchestration
export { buildVizResults } from './orchestrate.ts';
export type { UploadedFile, VizResult } from './orchestrate.ts';
