/**
 * A single OpenTelemetry span, narrowed to the fields coach reasons about.
 *
 * Coach is harness-agnostic: it consumes OTEL traces rather than coupling to any
 * particular agent framework's internal events.
 */
export interface Span {
  /** Unique span identifier within a trace. */
  spanId: string;
  /** Identifier of the trace this span belongs to. */
  traceId: string;
  /** Human-readable operation name (e.g. the tool or LLM call). */
  name: string;
  /** Span start time, in nanoseconds since the Unix epoch. */
  startTimeUnixNano: number;
  /** Span end time, in nanoseconds since the Unix epoch. */
  endTimeUnixNano: number;
}
