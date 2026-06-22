// Read-only UX guard. The DATABASE enforces read-only — the engine is the real
// boundary: the backend opens a READ_ONLY connection with external access disabled
// and configuration locked (see @coach/mcp's DuckDB backend). This guard only gives
// a friendly, fast error for the common mistakes — a non-SELECT statement or a
// multi-statement payload — instead of a raw engine error.
//
// It deliberately does NOT scan for keywords: a blocklist over SQL text both
// misfires (a keyword inside a string literal, e.g. WHERE bash_command = 'pnpm
// install') and can never be the actual boundary.

const READ_ONLY_START = /^(with|select)\b/i;

/** Returns the trimmed single-statement SQL, or throws a clear error. */
export function assertReadOnly(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed.length === 0) throw new Error('empty query');
  if (trimmed.includes(';')) throw new Error('only a single statement is allowed (no `;`)');
  if (!READ_ONLY_START.test(trimmed)) throw new Error('only SELECT / WITH queries are allowed');
  return trimmed;
}
