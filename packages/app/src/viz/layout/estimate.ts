import type { NodeCard } from '../format/format.ts';
import { roleFor } from '../theme.ts';

// Card height is estimated (not measured) so layout can run before render. All px.
// Banners and the prompt anchor are fixed; step cards grow with their lines.
const BANNER_H = 48;
const ANCHOR_H = 70;
const STEP_MIN_H = 64;
const STEP_PAD = 24; // 11px top + 11px bottom + slack
const TAG_H = 15;
const TITLE_H = 21;
const LINE_H = 18; // sub-verb / model / a structural field

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
