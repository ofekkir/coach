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

  // ── Paraphrased-intent regression set ────────────────────────────────────────
  // Real prompts that the keyword-literal classifier dumped into `other`. These
  // carry a clear intent expressed without the canonical verb; the broadened cues
  // must keep capturing them.
  const PARAPHRASE_SET: readonly { prompt: string; expected: IntentCategory }[] = [
    {
      prompt: 'I feel comments in the code should be replaced by a self documented function names',
      expected: 'refactor',
    },
    { prompt: 'It seems to me like there is duplication in types..', expected: 'refactor' },
    { prompt: 'I want to separate the logic from visualziation', expected: 'refactor' },
    { prompt: 'Can you decouple the renderer from the layout engine?', expected: 'refactor' },
    { prompt: 'Can you run e2e for both session.jsonl files?', expected: 'test' },
    { prompt: 'run the tests and the vitest suite', expected: 'test' },
    { prompt: "Let's break it down into etl steps", expected: 'feature' },
    { prompt: 'Why does the import keep failing unexpectedly?', expected: 'debug' },
    { prompt: 'What was the query that consumed the most tokens?', expected: 'explain' },
    { prompt: 'Should it be part of claude.md or Readme.md?', expected: 'explain' },
    { prompt: 'Is interaction the otel phrase for turn?', expected: 'explain' },
  ];

  it('classifies paraphrased intent it used to miss', () => {
    for (const { prompt, expected } of PARAPHRASE_SET) {
      expect(classifyIntent(prompt), prompt).toBe(expected);
    }
  });
});
