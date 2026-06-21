import { describe, expect, it } from 'vitest';
import { shapeResult, type RawResult } from './result.ts';

function rawRows(n: number, cell: (i: number) => Record<string, unknown>): RawResult {
  return { columns: ['x'], rows: Array.from({ length: n }, (_, i) => cell(i)) };
}

describe('shapeResult', () => {
  it('passes a small result through untruncated', () => {
    const out = shapeResult(rawRows(3, (i) => ({ x: i })));
    expect(out.rowCount).toBe(3);
    expect(out.rows).toHaveLength(3);
    expect(out.truncated).toBe(false);
  });

  it('caps rows at maxRows and flags truncation, reporting the true total', () => {
    const out = shapeResult(
      rawRows(10, (i) => ({ x: i })),
      {
        maxRows: 4,
        maxBytes: 1_000_000,
        maxCellChars: 1000,
      },
    );
    expect(out.rows).toHaveLength(4);
    expect(out.rowCount).toBe(10);
    expect(out.truncated).toBe(true);
  });

  it('enforces a byte budget, always keeping at least one row', () => {
    const big = 'a'.repeat(500);
    const out = shapeResult(
      rawRows(100, () => ({ x: big })),
      {
        maxRows: 1000,
        maxBytes: 1000,
        maxCellChars: 10_000,
      },
    );
    expect(out.rows.length).toBeGreaterThanOrEqual(1);
    expect(out.rows.length).toBeLessThan(100);
    expect(out.truncated).toBe(true);
  });

  it('clips an oversized cell and flags truncation', () => {
    const out = shapeResult(
      rawRows(1, () => ({ x: 'b'.repeat(50) })),
      {
        maxRows: 10,
        maxBytes: 1_000_000,
        maxCellChars: 10,
      },
    );
    expect(String(out.rows[0]?.x)).toContain('[clipped]');
    expect(String(out.rows[0]?.x).length).toBeLessThan(50);
    expect(out.truncated).toBe(true);
  });
});
