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
  /** Rows actually returned (`rows.length`); equals `rowCount` when nothing was dropped. */
  readonly returnedRows: number;
  /** Rows removed by the row/byte cap (`rowCount - returnedRows`); 0 when only cells were clipped. */
  readonly droppedRows: number;
  /** Plain-language warning, present and non-empty IFF something was reduced — names how
   *  many rows were dropped, which cap fired, whether cells were clipped, and how to recover. */
  readonly notice?: string;
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

/** Whether the row/byte cap fired, and which one — so the notice can name the cause.
 *  `row` means we kept exactly `maxRows` and more existed; `byte` means we stopped on the
 *  serialized-byte budget before reaching `maxRows`. */
type DropCause = 'none' | 'row' | 'byte';

function dropCause(returnedRows: number, totalRows: number, maxRows: number): DropCause {
  if (returnedRows >= totalRows) return 'none';
  if (returnedRows >= maxRows) return 'row';
  return 'byte';
}

function buildNotice(
  droppedRows: number,
  totalRows: number,
  cause: DropCause,
  clippedAny: boolean,
): string | undefined {
  const remediation =
    'narrow your SELECT (fewer/shorter columns) or page with LIMIT/OFFSET to retrieve the rest';
  if (cause === 'byte')
    return `${String(droppedRows)} of ${String(totalRows)} rows were dropped because the result hit the serialized-byte budget${clippedAny ? ' (some cells were also clipped)' : ''}. To get the rest, ${remediation}.`;
  if (cause === 'row')
    return `${String(droppedRows)} of ${String(totalRows)} rows were dropped because the result hit the row cap${clippedAny ? ' (some cells were also clipped)' : ''}. To get the rest, ${remediation}.`;
  if (clippedAny)
    return `0 rows were dropped, but some cells were clipped to fit the per-cell length limit. The full cell values are not shown; ${remediation}.`;
  return undefined;
}

/** Caps rows by count and serialized bytes (always keeping ≥1 row) and clips long
 *  cells. `rowCount` is the true pre-cap total; `truncated` flags any reduction; `notice`
 *  spells out — in plain language — what was cut, why, and how to recover. */
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
  const rowCount = raw.rows.length;
  const returnedRows = kept.length;
  const droppedRows = rowCount - returnedRows;
  const cause = dropCause(returnedRows, rowCount, limits.maxRows);
  const notice = buildNotice(droppedRows, rowCount, cause, clippedAny);
  return {
    columns: raw.columns,
    rows: kept,
    rowCount,
    returnedRows,
    droppedRows,
    truncated: droppedRows > 0 || clippedAny,
    ...(notice != null && { notice }),
  };
}
