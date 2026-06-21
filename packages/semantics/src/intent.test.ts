import { describe, expect, it } from 'vitest';
import { INTENT_CATEGORIES, classifyIntent, type IntentCategory } from './intent.ts';

describe('classifyIntent', () => {
  it('is never NULL — empty/whitespace prompt falls back to other', () => {
    expect(classifyIntent(undefined)).toBe('other');
    expect(classifyIntent('')).toBe('other');
    expect(classifyIntent('   ')).toBe('other');
  });

  it('always returns a member of the closed vocabulary', () => {
    const got = classifyIntent('please do the thing with the stuff');
    expect(INTENT_CATEGORIES).toContain(got);
  });

  // ── Documented gold set ──────────────────────────────────────────────────────
  // 15 representative prompts hand-labeled with their expected intent_category.
  // The deterministic classifier must match ≥80% (≥12/15). The measured rate is
  // asserted below and reported in the PR body.
  const GOLD_SET: readonly { prompt: string; expected: IntentCategory }[] = [
    { prompt: 'Fix the failing build — it throws a TypeError on startup', expected: 'debug' },
    { prompt: 'The login button does nothing when clicked, can you debug it?', expected: 'debug' },
    { prompt: 'Add a dark-mode toggle to the settings page', expected: 'feature' },
    { prompt: 'Implement a /health endpoint that returns 200', expected: 'feature' },
    { prompt: 'Refactor the auth module to remove the duplication', expected: 'refactor' },
    { prompt: 'Rename getUser to fetchUser everywhere', expected: 'refactor' },
    { prompt: 'Explain how the caching layer works', expected: 'explain' },
    { prompt: 'What does this regex actually match?', expected: 'explain' },
    { prompt: 'Write unit tests for the parser', expected: 'test' },
    { prompt: 'Increase test coverage for the pricing module', expected: 'test' },
    { prompt: 'Set up the CI pipeline to run on every push', expected: 'ops' },
    { prompt: 'Bump the eslint dependency and commit the change', expected: 'ops' },
    { prompt: 'Research the best charting library for React', expected: 'research' },
    { prompt: 'Compare DuckDB and SQLite for our use case', expected: 'research' },
    { prompt: 'hey', expected: 'other' },
  ];

  it('matches the gold set at >= 80%', () => {
    const matches = GOLD_SET.filter((g) => classifyIntent(g.prompt) === g.expected).length;
    const rate = matches / GOLD_SET.length;
    expect(rate).toBeGreaterThanOrEqual(0.8);
  });
});
