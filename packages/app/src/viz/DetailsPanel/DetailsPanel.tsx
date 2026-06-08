import type { GraphNode } from '@coach/pipeline';
import { colorOf } from '../layout/colors.ts';
import type { NodeCard } from '../format/format.ts';
import { formatMetrics } from '../format/format.ts';
import { JsonView } from '../JsonView/JsonView.tsx';

function sectionLabel(text: string): React.ReactNode {
  return (
    <div
      style={{
        color: '#94a3b8',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        marginBottom: 6,
      }}
    >
      {text}
    </div>
  );
}

function summaryRows(card: NodeCard): React.ReactNode {
  const { duration, secondary } = formatMetrics(card.metrics);
  const rows: { label: string; value: string }[] = [
    ...(card.title != null ? [{ label: 'title', value: card.title }] : []),
    ...card.fields.map((f) => ({ label: f.label, value: f.value })),
    ...(duration != null ? [{ label: 'duration', value: duration }] : []),
    ...(secondary != null ? [{ label: 'metrics', value: secondary }] : []),
  ];
  return rows.map((r) => (
    <div key={r.label} style={{ marginBottom: 8, fontSize: 11, color: '#374151', lineHeight: 1.5 }}>
      <span style={{ color: '#94a3b8' }}>{r.label}: </span>
      {r.value}
    </div>
  ));
}

export function DetailsPanel({
  card,
  canonical,
  onClose,
}: {
  card: NodeCard;
  canonical: GraphNode | undefined;
  onClose: () => void;
}) {
  const color = colorOf(card.type);

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        background: '#ffffff',
        borderLeft: '1px solid #e2e8f0',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.06)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            background: color,
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 3,
            letterSpacing: '0.07em',
          }}
        >
          {card.type.toUpperCase()}
        </span>
        <button
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: '0 2px',
          }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {sectionLabel('Summary')}
        {summaryRows(card)}
        <div style={{ height: 1, background: '#e2e8f0', margin: '14px 0' }} />
        {sectionLabel('Raw node')}
        <JsonView value={canonical} />
      </div>
    </div>
  );
}
