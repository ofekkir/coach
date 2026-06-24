import { fonts, tokens } from '../theme.ts';

import { FocusInput } from './FocusInput.tsx';
import type { RunStats } from './stats.ts';

function breadcrumb(segments: readonly string[]): React.ReactNode {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: fonts.mono,
        fontSize: 12,
        color: tokens.muted,
      }}
    >
      {segments.map((seg, i) => (
        <span key={seg} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {i > 0 && <span style={{ color: tokens.slash }}>/</span>}
          <span style={{ color: i === segments.length - 1 ? tokens.ink : tokens.muted }}>
            {seg}
          </span>
        </span>
      ))}
    </div>
  );
}

const textBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontFamily: fonts.mono,
  fontSize: 11,
  color: tokens.muted,
  padding: '4px 6px',
};

export function TopBar({
  title,
  stats,
  onCollapseAll,
  onFocus,
}: {
  title: string;
  stats: RunStats;
  onCollapseAll: () => void;
  onFocus: (id: string) => boolean;
}) {
  return (
    <div
      style={{
        height: 56,
        flexShrink: 0,
        background: tokens.surfaceWarm,
        borderBottom: `1px solid ${tokens.line}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: tokens.accent }} />
        <span
          style={{
            fontFamily: fonts.sans,
            fontWeight: 600,
            fontSize: 15,
            letterSpacing: '-0.01em',
            color: tokens.inkBlack,
          }}
        >
          coach
        </span>
        <span style={{ fontFamily: fonts.mono, fontSize: 11, color: tokens.faint }}>· {title}</span>
      </div>
      <div style={{ width: 1, height: 20, background: tokens.line }} />
      {breadcrumb(stats.breadcrumb)}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
        <FocusInput onFocus={onFocus} />
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={textBtn} onClick={onCollapseAll}>
            collapse all
          </button>
        </div>
      </div>
    </div>
  );
}
