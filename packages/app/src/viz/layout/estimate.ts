import type { NodeCard } from '../format/format.ts';

// Card height is estimated (not measured) so layout can run before render. All px.
const MIN_NODE_H = 62;
const BADGE_H = 28;
const BADGE_GAP = 6;
const TITLE_H = 18;
const FIELD_LINE_H = 16;
const METRICS_H = 24;
const BODY_PAD = 8;

function hasAnyMetric(card: NodeCard): boolean {
  const { durationMs, tokensIn, tokensOut, costUsd } = card.metrics;
  return durationMs != null || tokensIn != null || tokensOut != null || costUsd != null;
}

export function estimateNodeH(card: NodeCard): number {
  const titleH = card.title != null ? TITLE_H : 0;
  const fieldsH = card.fields.length * FIELD_LINE_H;
  const metricsH = hasAnyMetric(card) ? METRICS_H : 0;

  const contentH = BADGE_H + BADGE_GAP + titleH + fieldsH + metricsH + BODY_PAD;
  return Math.max(MIN_NODE_H, contentH);
}
