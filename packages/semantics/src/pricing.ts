// ════════════════════════════════════════════════════════════════════════════
// Model → price table + a pure cost deriver. The OTEL path often carries an
// explicit `cost_usd` (the harness already priced the call); native logs usually
// do NOT. When cost is absent but `model` + token counts are present, the pipeline
// derives it from this table. A model absent here yields `null` (never 0) so the
// caller can leave the column NULL and log a warning — a derived 0 would silently
// understate cost and corrupt rollups.
//
// The per-MILLION-token USD rates live in ./data/pricing/model-prices.json (data,
// not code; bundled, never read from disk — same convention as the ontology). This
// module converts them to per-token rates and exposes the pure deriver. Source +
// date are documented in that JSON's `note`.
// ════════════════════════════════════════════════════════════════════════════

import modelPricesData from './data/pricing/model-prices.json' with { type: 'json' };

const PER_MILLION = 1_000_000;

/** Per-token input/output USD price for a model. */
export interface ModelPrice {
  readonly inputUsdPerToken: number;
  readonly outputUsdPerToken: number;
}

interface PerMTokPrice {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
}

const PER_MTOK: Readonly<Record<string, PerMTokPrice>> = modelPricesData.models;

// A dated snapshot id (`claude-haiku-4-5-20251001`) prices the same as its base
// alias. Strip a trailing `-YYYYMMDD` (or `@YYYYMMDD`) before lookup.
function normalizeModel(model: string): string {
  return model.replace(/[-@]\d{8}$/, '');
}

function perTokenPrice(rate: PerMTokPrice): ModelPrice {
  return {
    inputUsdPerToken: rate.inputPerMTok / PER_MILLION,
    outputUsdPerToken: rate.outputPerMTok / PER_MILLION,
  };
}

/** The price table entry for a model id, or `null` for an unknown model. */
export function modelPrice(model: string): ModelPrice | null {
  const rate = PER_MTOK[model] ?? PER_MTOK[normalizeModel(model)];
  return rate != null ? perTokenPrice(rate) : null;
}

/**
 * Derives an llm_request's USD cost from its model and token counts. Pure and
 * deterministic. Returns `null` for an unknown model (the caller must NOT coerce
 * to 0 — a NULL cost is the honest signal that the price is unknown) and for a
 * negative/non-finite token count. A known model with finite non-negative token
 * counts always yields a finite non-negative number.
 */
export function costUsd(model: string, tokensIn: number, tokensOut: number): number | null {
  const price = modelPrice(model);
  if (price == null) return null;
  if (!Number.isFinite(tokensIn) || !Number.isFinite(tokensOut)) return null;
  if (tokensIn < 0 || tokensOut < 0) return null;
  return tokensIn * price.inputUsdPerToken + tokensOut * price.outputUsdPerToken;
}
