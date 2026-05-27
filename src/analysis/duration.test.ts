import { describe, expect, it } from 'vitest';
import type { Span } from '../trace/span';
import { computeSpanDurationMs } from './duration';

function makeSpan(startNano: number, endNano: number): Span {
  return {
    spanId: 'span-1',
    traceId: 'trace-1',
    name: 'llm.generate',
    startTimeUnixNano: startNano,
    endTimeUnixNano: endNano,
  };
}

describe('computeSpanDurationMs', () => {
  it('converts a nanosecond span into milliseconds', () => {
    expect(computeSpanDurationMs(makeSpan(0, 5_000_000))).toBe(5);
  });

  it('returns 0 for a zero-length span', () => {
    expect(computeSpanDurationMs(makeSpan(1_000, 1_000))).toBe(0);
  });

  it('throws when the span ends before it starts', () => {
    expect(() => computeSpanDurationMs(makeSpan(10, 5))).toThrow(RangeError);
  });
});
