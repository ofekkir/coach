import type { NodeCard } from '../format/format.ts';
import { roleFor } from '../theme.ts';

// Why: card height is estimated (not measured) so layout can run before render,
// before the DOM exists. Banners and the prompt anchor are fixed; step cards grow
// with their lines. All values in px.
const BANNER_H = 48;
const ANCHOR_H = 70;
const STEP_MIN_H = 64;
const STEP_PAD_TOP = 11;
const STEP_PAD_BOTTOM = 11;
const STEP_PAD_SLACK = 2;
const STEP_PAD = STEP_PAD_TOP + STEP_PAD_BOTTOM + STEP_PAD_SLACK;
const TAG_H = 15;
const TITLE_H = 21;
const LINE_H = 18;

export function estimateNodeH(card: NodeCard): number {
  const role = roleFor(card.type);
  if (role === 'banner') return BANNER_H;
  if (role === 'anchor') return ANCHOR_H;

  const subtitleH = card.subtitle != null ? LINE_H : 0;
  const modelH = card.model != null ? LINE_H : 0;
  const fieldsH = card.fields.length * LINE_H;
  const contentH = STEP_PAD + TAG_H + TITLE_H + subtitleH + modelH + fieldsH;
  return Math.max(STEP_MIN_H, contentH);
}
