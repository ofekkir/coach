import type { NodeCard } from '../format/format.ts';
import { fonts, tokens } from '../theme.ts';

const TAG_WEIGHT = 600;

function errorKindRow(kind: string): React.ReactNode {
  return (
    <div
      style={{
        fontFamily: fonts.mono,
        fontSize: 11,
        color: tokens.dangerInk,
        marginTop: 8,
        wordBreak: 'break-word',
      }}
    >
      {kind}
    </div>
  );
}

function errorMessageRow(message: string): React.ReactNode {
  return (
    <div
      style={{
        fontFamily: fonts.sans,
        fontSize: 13,
        lineHeight: 1.5,
        color: tokens.dangerInk,
        marginTop: 8,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {message}
    </div>
  );
}

// The failure callout: an ✕ glyph + FAILED tag, the closed `error_kind`, and the
// ≤500-char `error_message` text. Shown above everything else in the panel — a
// failed step's outcome is the first thing to read. Color is not the only cue (the
// ✕ glyph + FAILED word carry it too).
export function errorCallout(error: NonNullable<NodeCard['error']>): React.ReactNode {
  return (
    <div
      data-error-callout
      style={{
        background: tokens.dangerBg,
        border: `1px solid ${tokens.dangerBorder}`,
        borderRadius: 10,
        padding: '13px 14px',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ fontFamily: fonts.mono, fontSize: 12, color: tokens.danger }}>
          ✕
        </span>
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: 9.5,
            letterSpacing: '0.1em',
            fontWeight: TAG_WEIGHT,
            color: tokens.danger,
          }}
        >
          FAILED
        </span>
      </div>
      {error.kind != null && errorKindRow(error.kind)}
      {error.message != null && errorMessageRow(error.message)}
    </div>
  );
}
