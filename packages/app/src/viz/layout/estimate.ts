import type { NodeCard } from '../format/format.ts';

function hasAnyMetric(card: NodeCard): boolean {
  const { durationMs, tokensIn, tokensOut, costUsd } = card.metrics;
  return durationMs != null || tokensIn != null || tokensOut != null || costUsd != null;
}

export function estimateNodeH(card: NodeCard): number {
  const titleH = card.title != null ? 18 : 0;
  const fieldsH = card.fields.length * 16;
  const metricsH = hasAnyMetric(card) ? 24 : 0;

  return Math.max(62, 28 + 6 + titleH + fieldsH + metricsH + 8);
}
