import type { Span } from '../trace/span';

const NANOS_PER_MILLI = 1_000_000;

/**
 * Returns the wall-clock duration of a span in milliseconds.
 *
 * @throws {RangeError} if the span ends before it starts.
 */
export function computeSpanDurationMs(span: Span): number {
  const durationNanos = span.endTimeUnixNano - span.startTimeUnixNano;
  if (durationNanos < 0) {
    throw new RangeError(
      `Span ${span.spanId} ends before it starts ` +
        `(start=${String(span.startTimeUnixNano)}, end=${String(span.endTimeUnixNano)})`,
    );
  }
  return durationNanos / NANOS_PER_MILLI;
}
