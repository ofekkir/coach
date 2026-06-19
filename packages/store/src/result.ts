// Result shaping: turns a backend's raw rows into the capped, JSON-safe QueryResult
// the analyst sees. Two ceilings keep a broad query from blowing the agent's context
// — a row cap AND a hard serialized-byte budget — plus per-cell clipping so a single
// huge column (e.g. a long `prompt`) can't overflow. `truncated` flags any of these.

export interface RawResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
}

export interface QueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  /** Total rows the query produced (before any cap), so callers see what was cut. */
  readonly rowCount: number;
  /** True if rows were dropped (row/byte cap) or any cell was clipped. */
  readonly truncated: boolean;
}

export interface ResultLimits {
  readonly maxRows: number;
  readonly maxBytes: number;
  readonly maxCellChars: number;
}

const MAX_ROWS = 1000;
const MAX_BYTES = 256_000;
const MAX_CELL_CHARS = 4000;

export const DEFAULT_LIMITS: ResultLimits = {
  maxRows: MAX_ROWS,
  maxBytes: MAX_BYTES,
  maxCellChars: MAX_CELL_CHARS,
};

const CLIP_MARKER = '…[clipped]';

function clipCell(value: unknown, maxChars: number): { value: unknown; clipped: boolean } {
  if (typeof value !== 'string' || value.length <= maxChars) return { value, clipped: false };
  return { value: value.slice(0, maxChars) + CLIP_MARKER, clipped: true };
}

function clipRow(
  row: Record<string, unknown>,
  maxChars: number,
): { row: Record<string, unknown>; clipped: boolean } {
  const out: Record<string, unknown> = {};
  let clipped = false;
  for (const [key, value] of Object.entries(row)) {
    const cell = clipCell(value, maxChars);
    out[key] = cell.value;
    clipped ||= cell.clipped;
  }
  return { row: out, clipped };
}

/** Caps rows by count and serialized bytes (always keeping ≥1 row) and clips long
 *  cells. `rowCount` is the true pre-cap total; `truncated` flags any reduction. */
export function shapeResult(raw: RawResult, limits: ResultLimits = DEFAULT_LIMITS): QueryResult {
  const kept: Record<string, unknown>[] = [];
  let bytes = 0;
  let clippedAny = false;
  for (const row of raw.rows) {
    if (kept.length >= limits.maxRows) break;
    const { row: clippedRow, clipped } = clipRow(row, limits.maxCellChars);
    const rowBytes = JSON.stringify(clippedRow).length;
    if (kept.length > 0 && bytes + rowBytes > limits.maxBytes) break;
    kept.push(clippedRow);
    bytes += rowBytes;
    clippedAny ||= clipped;
  }
  return {
    columns: raw.columns,
    rows: kept,
    rowCount: raw.rows.length,
    truncated: kept.length < raw.rows.length || clippedAny,
  };
}
