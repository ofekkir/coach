import { ellipsis, fonts, glyphFor, tokens } from '../theme.ts';
import type { NodeCard } from '../format/format.ts';
import { NW } from '../layout/types.ts';
import { Glyph } from './Glyph.tsx';

// The colored depth rail that marks a level banner's place in the hierarchy.
const BANNER_RAIL: Record<string, string> = {
  agent: tokens.ink,
  session: tokens.inkSoft,
  interaction: tokens.connector,
};

// A level (agent / session / interaction): a banner, not a step card — different
// scale, a depth rail, the id in mono. Structure, not color, says "a level above."
export function renderBanner(card: NodeCard): React.ReactNode {
  return (
    <div
      style={{
        width: NW,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: tokens.banner,
        border: `1px solid ${tokens.dot}`,
        borderLeft: `3px solid ${BANNER_RAIL[card.type] ?? tokens.connector}`,
        borderRadius: 9,
        padding: '9px 14px',
        fontFamily: fonts.sans,
      }}
    >
      <Glyph kind={glyphFor(card.type)} accent={false} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 9.5,
            letterSpacing: '0.14em',
            color: tokens.faint,
          }}
        >
          {card.tag}
        </div>
        {card.title != null && (
          <div
            style={{ ...ellipsis, fontFamily: fonts.mono, fontSize: 12.5, color: tokens.inkValue }}
          >
            {card.title}
          </div>
        )}
      </div>
    </div>
  );
}

// The user-prompt anchor — the goal source the run responds to, and the one
// level-ish node that wears the accent (border, halo dot, soft shadow).
export function renderAnchor(card: NodeCard): React.ReactNode {
  return (
    <div
      style={{
        width: NW,
        background: tokens.surface,
        border: `1.5px solid ${tokens.accentBorder}`,
        borderRadius: 11,
        padding: '13px 16px',
        boxShadow: '0 2px 10px -4px rgba(160,90,50,0.18)',
        fontFamily: fonts.sans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
        <Glyph kind="dot-halo" accent />
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: 9.5,
            letterSpacing: '0.14em',
            color: tokens.accentInkSoft,
          }}
        >
          {card.tag}
        </span>
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: tokens.inkBlack,
          lineHeight: 1.35,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {card.title}
      </div>
    </div>
  );
}
