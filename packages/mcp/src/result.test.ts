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
    expect(out.returnedRows).toBe(3);
    expect(out.droppedRows).toBe(0);
    expect(out.returnedRows).toBe(out.rowCount);
    expect(out.returnedRows).toBe(out.rows.length);
    expect(out.notice).toBeUndefined();
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
    // Each row is tiny, so the cap that fired is the ROW cap, not bytes.
    expect(out.returnedRows).toBe(4);
    expect(out.droppedRows).toBe(6);
    expect(out.notice).toBeDefined();
    expect(out.notice).toContain('6 of 10 rows');
    expect(out.notice).toContain('row cap');
    expect(out.notice).not.toContain('serialized-byte budget');
    expect(out.notice).toMatch(/LIMIT\/OFFSET/);
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
    // Stopped before reaching maxRows (1000), so the BYTE budget is the cause.
    expect(out.returnedRows).toBe(out.rows.length);
    expect(out.returnedRows).toBeLessThan(out.rowCount);
    expect(out.droppedRows).toBe(out.rowCount - out.returnedRows);
    expect(out.droppedRows).toBeGreaterThan(0);
    expect(out.notice).toBeDefined();
    expect(out.notice).toContain('serialized-byte budget');
    expect(out.notice).not.toContain('row cap');
    expect(out.notice).toContain(`${String(out.droppedRows)} of 100 rows`);
    expect(out.notice).toMatch(/LIMIT\/OFFSET/);
  });

  it('clips an oversized cell without dropping rows', () => {
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
    // Clipping is not a dropped row — guards the row/clip conflation.
    expect(out.droppedRows).toBe(0);
    expect(out.returnedRows).toBe(out.rowCount);
    expect(out.notice).toBeDefined();
    expect(out.notice).toContain('0 rows were dropped');
    expect(out.notice).toContain('clipped');
  });
});
