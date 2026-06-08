// Card height is estimated (not measured) so layout can run before render. All px.
const MIN_NODE_H = 62;
const BADGE_H = 28;
const BADGE_GAP = 6;
const NAME_LINE_H = 18;
const DETAIL_LINE_H = 16;
const TIMING_LINE_H = 20;
const BODY_PAD = 8;

export function estimateNodeH(labelLines: readonly string[]): number {
  const body = labelLines.slice(1);
  const timingIdx = body.findIndex((l) => l.startsWith('duration:'));
  const hasTiming = timingIdx >= 0;
  const displayLines = hasTiming ? body.filter((_, i) => i !== timingIdx) : body;
  const hasName = displayLines.length > 0;
  const detailCount = Math.max(0, displayLines.length - (hasName ? 1 : 0));

  const contentH =
    BADGE_H +
    BADGE_GAP +
    (hasName ? NAME_LINE_H : 0) +
    detailCount * DETAIL_LINE_H +
    (hasTiming ? TIMING_LINE_H : 0) +
    BODY_PAD;
  return Math.max(MIN_NODE_H, contentH);
}
