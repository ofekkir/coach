import { tokens, type GlyphKind } from '../theme.ts';

// Why: a CSS shape encodes a node's structural role, replacing the old colored
// badge. Hollow = inference (a thought); filled = action (a deed); solid fills =
// levels; the accent variants mark the prompt anchor and nested weak-model calls.
// Every glyph is a single styled span.
const BASE: React.CSSProperties = { flexShrink: 0, display: 'inline-block' };

const ROUND = '50%';
const ROTATE = 'rotate(45deg)';

// Why: resolve the accent-sensitive colors up front so the shape switch below
// stays a flat lookup instead of branching on accent in every case.
function accentColors(accent: boolean): {
  hollowBorder: string;
  hollowBg: string;
  squareBg: string;
} {
  if (accent)
    return { hollowBorder: tokens.accent, hollowBg: tokens.accentBg, squareBg: tokens.accent };
  return { hollowBorder: tokens.inkSoft, hollowBg: tokens.paper, squareBg: tokens.inkSoft };
}

function glyphStyle(kind: GlyphKind, accent: boolean): React.CSSProperties {
  const { hollowBorder, hollowBg, squareBg } = accentColors(accent);
  switch (kind) {
    case 'diamond-filled':
      return { ...BASE, width: 12, height: 12, background: tokens.ink, transform: ROTATE };
    case 'circle-filled':
      return { ...BASE, width: 11, height: 11, borderRadius: ROUND, background: tokens.inkSoft };
    case 'circle-ring':
      return {
        ...BASE,
        width: 10,
        height: 10,
        borderRadius: ROUND,
        background: tokens.inkSoft,
        boxShadow: `0 0 0 2px ${tokens.connector}`,
      };
    case 'dot-halo':
      return {
        ...BASE,
        width: 12,
        height: 12,
        borderRadius: ROUND,
        background: tokens.accent,
        boxShadow: `0 0 0 3px ${tokens.accentBg}`,
      };
    case 'circle-hollow':
      return {
        ...BASE,
        width: 13,
        height: 13,
        borderRadius: ROUND,
        border: `2px solid ${hollowBorder}`,
        background: hollowBg,
      };
    case 'square-filled':
      return { ...BASE, width: 12, height: 12, background: squareBg };
    case 'diamond-hollow':
      return {
        ...BASE,
        width: 11,
        height: 11,
        border: `1.5px solid ${tokens.accent}`,
        background: tokens.accentBg,
        transform: ROTATE,
      };
  }
}

export function Glyph({ kind, accent }: { kind: GlyphKind; accent: boolean }) {
  return <span style={glyphStyle(kind, accent)} />;
}
