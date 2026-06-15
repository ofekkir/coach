import type {
  CanonicalNode,
  ClassifiedInput,
  LogEntry,
  SessionInputs,
  TempoTrace,
} from '../types.ts';
import { enrichTrace } from './enrich/enrich.ts';
import { nativeSessionToTrace } from './native/native.ts';
import { transformTrace } from './transform/transform.ts';

function joinTraces(traces: readonly TempoTrace[]): TempoTrace {
  return { batches: traces.flatMap((t) => t.batches) };
}

// OTEL path: join every trace of the session into one unified OTLP object,
// fold the logs into it (enrich), and convert to canonical nodes in one pass.
function otelToCanonical(
  traces: readonly TempoTrace[],
  logs: readonly LogEntry[],
): CanonicalNode[] {
  const unified = enrichTrace(joinTraces(traces), logs);
  return transformTrace(unified, true);
}

// Native path: facade over today's jsonl → OTLP → transform. The OTLP round-trip
// is an internal detail behind this boundary — the next batch removes it so native
// builds canonical nodes directly.
function nativeToCanonical(jsonl: string): CanonicalNode[] {
  return transformTrace(nativeSessionToTrace(jsonl));
}

function nativeFromInputs(inputs: readonly ClassifiedInput[]): CanonicalNode[] {
  const native = inputs.find((i) => i.type === 'native');
  return native != null ? nativeToCanonical(native.file.content) : [];
}

function otelFromInputs(inputs: readonly ClassifiedInput[]): CanonicalNode[] {
  const traces = inputs
    .filter((i) => i.type === 'otel-trace')
    .sort((a, b) => a.file.name.localeCompare(b.file.name))
    .map((i) => JSON.parse(i.file.content) as TempoTrace);
  if (traces.length === 0) return [];

  const logs = inputs
    .filter((i) => i.type === 'otel-log')
    .flatMap((i) => JSON.parse(i.file.content) as LogEntry[]);

  return otelToCanonical(traces, logs);
}

// Stage 3: turn one session's inputs into a canonical node forest. Every node
// already carries its `sessionId` FK (stamped in transform); the owning Session
// entity is synthesized later, in aggregate.
export function toCanonical(session: SessionInputs): CanonicalNode[] {
  return session.kind === 'native'
    ? nativeFromInputs(session.inputs)
    : otelFromInputs(session.inputs);
}
