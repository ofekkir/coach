// ETL
export {
  addSessionNode,
  aggregateAgent,
  aggregateSession,
  groupSessionsByAgent,
} from './etl/aggregate.ts';
export { enrichTrace } from './etl/enrich/enrich.ts';
export { nativeSessionToTrace } from './etl/native/native.ts';
export { TempoTraceSchema } from './etl/tempo.schema.ts';
export { transformTrace } from './etl/transform/transform.ts';
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
export { buildCausalGraphView } from './graph/view-model/graph-view.ts';
export {
  buildAgentCausalGraphView,
  buildSessionCausalGraphView,
} from './graph/view-model/session-view.ts';
export type {
  AgentCausalGraphView,
  CausalGraphView,
  GraphViewEdge,
  GraphViewNode,
  GraphViewThread,
  SessionCausalGraphView,
  VizData,
} from './graph/view-model/types.ts';

// Orchestration
export { buildVizResults } from './orchestrate.ts';
export type { UploadedFile, VizResult } from './orchestrate.ts';
