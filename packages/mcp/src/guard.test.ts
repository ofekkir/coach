import { describe, expect, it } from 'vitest';
import { assertReadOnly } from './guard.ts';

describe('assertReadOnly', () => {
  it('allows SELECT and WITH, returning the trimmed statement', () => {
    expect(assertReadOnly('  SELECT 1;')).toBe('SELECT 1');
    expect(assertReadOnly('WITH x AS (SELECT 1) SELECT * FROM x')).toMatch(/^WITH/);
  });

  it('does NOT reject keywords that appear inside string literals', () => {
    // the engine is the boundary; the guard must not blocklist SQL text
    expect(() => assertReadOnly("SELECT 'install' AS a, 'DROP rm -rf' AS b")).not.toThrow();
    expect(() =>
      assertReadOnly("SELECT * FROM nodes WHERE bash_command = 'pnpm install'"),
    ).not.toThrow();
  });

  it('rejects non-SELECT statements', () => {
    expect(() => assertReadOnly('DROP TABLE nodes')).toThrow();
    expect(() => assertReadOnly('DELETE FROM nodes')).toThrow();
    expect(() => assertReadOnly('UPDATE nodes SET x = 1')).toThrow();
  });

  it('rejects multi-statement payloads and empty input', () => {
    expect(() => assertReadOnly('SELECT 1; SELECT 2')).toThrow();
    expect(() => assertReadOnly('   ')).toThrow();
  });
});
