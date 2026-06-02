// ETL
export {
  addSessionNode,
  aggregateAgent,
  aggregateSession,
  groupSessionsByAgent,
} from './etl/aggregate.ts';
export { enrichTrace } from './etl/enrich/index.ts';
export { nativeSessionToTrace } from './etl/native/index.ts';
export { TempoTraceSchema } from './etl/tempo.schema.ts';
export { transformTrace } from './etl/transform/index.ts';
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
} from './graph/view-model/index.ts';
export type {
  AgentCausalGraphView,
  CausalGraphView,
  GraphViewEdge,
  GraphViewNode,
  GraphViewThread,
  SessionCausalGraphView,
  VizData,
} from './graph/view-model/index.ts';

// Orchestration
export { buildVizResults } from './orchestrate.ts';
export type { UploadedFile, VizResult } from './orchestrate.ts';
