import { fonts, tokens } from '../theme.ts';

interface LegendRow {
  label: string;
  caption: string;
  color: string;
}

const LEGEND_ROWS: readonly LegendRow[] = [
  { label: 'SRC', caption: 'source', color: tokens.source },
  { label: 'DST', caption: 'dest', color: tokens.dest },
];

function legendSwatch(row: LegendRow) {
  return (
    <span key={row.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: row.color,
          border: `1.5px solid ${row.color}`,
          borderRadius: 4,
          padding: '0 4px',
        }}
      >
        {row.label}
      </span>
      <span style={{ fontFamily: fonts.sans, fontSize: 11, color: tokens.inkSoft }}>
        {row.caption}
      </span>
    </span>
  );
}

// A small caption naming the source vs dest highlight, anchored top-left over the
// canvas. Shown only while a `?source`/`?dest` pair is highlighted.
export function HighlightLegend() {
  return (
    <div
      data-highlight-legend
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 5,
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        padding: '6px 10px',
        background: tokens.surfaceWarm,
        border: `1px solid ${tokens.line}`,
        borderRadius: 8,
      }}
    >
      {LEGEND_ROWS.map(legendSwatch)}
    </div>
  );
}
