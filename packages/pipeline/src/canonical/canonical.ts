import type {
  CanonicalNode,
  ClassifiedInput,
  LogEntry,
  SessionInputs,
  TempoTrace,
} from '../types.ts';
import { enrichTrace } from './enrich/enrich.ts';
import { nativeSessionToTrace } from './native/native.ts';
import { transformTrace, type OnUnknownCostModel } from './transform/transform.ts';

function joinTraces(traces: readonly TempoTrace[]): TempoTrace {
  return { batches: traces.flatMap((t) => t.batches) };
}

// OTEL path: join every trace of the session into one unified OTLP object,
// fold the logs into it (enrich), and convert to canonical nodes in one pass.
function otelToCanonical(
  traces: readonly TempoTrace[],
  logs: readonly LogEntry[],
  onUnknownCostModel?: OnUnknownCostModel,
): CanonicalNode[] {
  const unified = enrichTrace(joinTraces(traces), logs);
  return transformTrace(unified, true, onUnknownCostModel);
}

// Native path: facade over today's jsonl → OTLP → transform. The OTLP round-trip
// is an internal detail behind this boundary — the next batch removes it so native
// builds canonical nodes directly.
function nativeToCanonical(
  jsonl: string,
  onUnknownCostModel?: OnUnknownCostModel,
): CanonicalNode[] {
  return transformTrace(nativeSessionToTrace(jsonl), false, onUnknownCostModel);
}

function nativeFromInputs(
  inputs: readonly ClassifiedInput[],
  onUnknownCostModel?: OnUnknownCostModel,
): CanonicalNode[] {
  const native = inputs.find((i) => i.type === 'native');
  return native != null ? nativeToCanonical(native.file.content, onUnknownCostModel) : [];
}

function otelFromInputs(
  inputs: readonly ClassifiedInput[],
  onUnknownCostModel?: OnUnknownCostModel,
): CanonicalNode[] {
  const traces = inputs
    .filter((i) => i.type === 'otel-trace')
    .sort((a, b) => a.file.name.localeCompare(b.file.name))
    .map((i) => JSON.parse(i.file.content) as TempoTrace);
  if (traces.length === 0) return [];

  const logs = inputs
    .filter((i) => i.type === 'otel-log')
    .flatMap((i) => JSON.parse(i.file.content) as LogEntry[]);

  return otelToCanonical(traces, logs, onUnknownCostModel);
}

// Stage 3: turn one session's inputs into a canonical node forest. Every node
// already carries its `sessionId` FK (stamped in transform); the owning Session
// entity is synthesized later, in aggregate. `onUnknownCostModel` is the optional
// cost-derivation warning sink (NULL cost on an unpriced model).
export function toCanonical(
  session: SessionInputs,
  onUnknownCostModel?: OnUnknownCostModel,
): CanonicalNode[] {
  return session.kind === 'native'
    ? nativeFromInputs(session.inputs, onUnknownCostModel)
    : otelFromInputs(session.inputs, onUnknownCostModel);
}
