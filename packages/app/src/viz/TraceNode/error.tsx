import { fonts, tokens } from '../theme.ts';

const BADGE_WEIGHT = 600;

// A failed tool call wins the border: a danger outline + soft ring layered over
// whatever state styling the card already had, so failure reads at default zoom.
// It overrides the border but keeps its own ring color, distinct from the accent's
// selection halo — selection and failure can coexist on one card.
export function withDanger(style: React.CSSProperties): React.CSSProperties {
  return {
    ...style,
    border: `1.5px solid ${tokens.danger}`,
    boxShadow: `0 0 0 3px ${tokens.dangerRing}`,
  };
}

// The error badge: an ✕ glyph + ERROR tag. Color is NOT the only cue — colorblind
// readers get the shape + word. Shown in the header of a failed step.
export function ErrorBadge({ pushRight }: { pushRight: boolean }) {
  return (
    <span
      data-error-badge
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        marginLeft: pushRight ? 'auto' : 0,
        fontFamily: fonts.mono,
        fontSize: 9.5,
        fontWeight: BADGE_WEIGHT,
        letterSpacing: '0.1em',
        color: tokens.danger,
        flexShrink: 0,
      }}
    >
      <span aria-hidden style={{ fontSize: 11, lineHeight: 1 }}>
        ✕
      </span>
      ERROR
    </span>
  );
}
