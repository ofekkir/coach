import { describe, expect, it } from 'vitest';
import { costUsd, modelPrice } from './pricing.ts';

describe('modelPrice', () => {
  it('prices a known model per-token (Opus 4.8: $5/$25 per MTok)', () => {
    const price = modelPrice('claude-opus-4-8');
    expect(price).not.toBeNull();
    expect(price?.inputUsdPerToken).toBeCloseTo(5 / 1_000_000, 12);
    expect(price?.outputUsdPerToken).toBeCloseTo(25 / 1_000_000, 12);
  });

  it('resolves a dated snapshot id to its base alias', () => {
    expect(modelPrice('claude-haiku-4-5-20251001')).toEqual(modelPrice('claude-haiku-4-5'));
  });

  it('returns null for an unknown model', () => {
    expect(modelPrice('some-unknown-model')).toBeNull();
  });
});

describe('costUsd', () => {
  it('derives a non-NULL cost from a known model + tokens', () => {
    // 1000 in @ $3/MTok + 500 out @ $15/MTok = 0.003 + 0.0075 = 0.0105
    expect(costUsd('claude-sonnet-4-6', 1000, 500)).toBeCloseTo(0.0105, 9);
  });

  it('returns null (never 0) for an unknown model', () => {
    expect(costUsd('mystery-model', 1000, 500)).toBeNull();
  });

  it('returns 0 for a known model with zero tokens (priced, not unknown)', () => {
    expect(costUsd('claude-opus-4-8', 0, 0)).toBe(0);
  });

  it('returns null for non-finite or negative token counts', () => {
    expect(costUsd('claude-opus-4-8', Number.NaN, 10)).toBeNull();
    expect(costUsd('claude-opus-4-8', -1, 10)).toBeNull();
  });
});
