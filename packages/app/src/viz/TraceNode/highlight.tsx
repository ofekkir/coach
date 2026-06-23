import type { HighlightRole } from '../highlight/highlight.ts';
import { fonts, tokens } from '../theme.ts';

const BADGE_WEIGHT = 700;

interface RoleSkin {
  border: string;
  ring: string;
  badgeBg: string;
  label: string;
}

// Each role gets a distinct accent AND a distinct word (SRC/DST/MARK), so the pair
// reads for colorblind users on the badge alone. Kept off the clay `accent`
// (selection) and the red `danger` (failure) so it never collides with those.
const ROLE_SKIN: Record<HighlightRole, RoleSkin> = {
  source: {
    border: tokens.source,
    ring: tokens.sourceRing,
    badgeBg: tokens.sourceBg,
    label: 'SRC',
  },
  dest: { border: tokens.dest, ring: tokens.destRing, badgeBg: tokens.destBg, label: 'DST' },
  plain: { border: tokens.ink, ring: tokens.line, badgeBg: tokens.inset, label: 'MARK' },
};

// The pair-highlight outline: a role-colored border + soft ring layered over the
// card's existing state styling. Distinct ring color per role so source and dest
// are told apart at default zoom even before reading the badge.
export function withHighlight(
  style: React.CSSProperties,
  role: HighlightRole,
): React.CSSProperties {
  const skin = ROLE_SKIN[role];
  return { ...style, border: `2px solid ${skin.border}`, boxShadow: `0 0 0 3px ${skin.ring}` };
}

// The role badge (SRC / DST / MARK): color is not the only cue — the word carries
// the role. Shown in the header of a highlighted step.
export function HighlightBadge({ role }: { role: HighlightRole }) {
  const skin = ROLE_SKIN[role];
  return (
    <span
      data-highlight-badge
      data-role={role}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 'auto',
        padding: '1px 5px',
        borderRadius: 4,
        background: skin.badgeBg,
        fontFamily: fonts.mono,
        fontSize: 9,
        fontWeight: BADGE_WEIGHT,
        letterSpacing: '0.12em',
        color: skin.border,
        flexShrink: 0,
      }}
    >
      {skin.label}
    </span>
  );
}
