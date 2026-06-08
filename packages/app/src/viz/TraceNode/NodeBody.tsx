import type { CardField, CardMetrics } from '../format/format.ts';
import { formatMetrics } from '../format/format.ts';

const LINE: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

// Gap (px) under the title line when field lines follow it.
const TITLE_GAP_WITH_FIELDS = 2;

export function NodeBody({
  title,
  fields,
  metrics,
  color,
}: {
  title: string | undefined;
  fields: readonly CardField[];
  metrics: CardMetrics;
  color: string;
}) {
  const { duration, secondary } = formatMetrics(metrics);

  return (
    <div style={{ padding: '6px 10px 8px' }}>
      {title != null && (
        <div
          style={{
            ...LINE,
            color: '#1e293b',
            fontSize: 11,
            lineHeight: 1.4,
            marginBottom: fields.length > 0 ? TITLE_GAP_WITH_FIELDS : 0,
          }}
        >
          {title}
        </div>
      )}
      {fields.map((f) => (
        <div
          key={f.label}
          style={{ ...LINE, color: '#64748b', fontSize: 10, lineHeight: 1.45, marginTop: 1 }}
        >
          {f.label}: {f.value}
        </div>
      ))}
      {secondary != null && (
        <div style={{ ...LINE, color: '#64748b', fontSize: 10, lineHeight: 1.45, marginTop: 1 }}>
          {secondary}
        </div>
      )}
      {duration != null && (
        <div
          style={{
            display: 'inline-block',
            marginTop: 5,
            background: `${color}14`,
            border: `1px solid ${color}40`,
            borderRadius: 4,
            padding: '1px 6px',
            color,
            fontSize: 10,
            letterSpacing: '0.02em',
          }}
        >
          {duration}
        </div>
      )}
    </div>
  );
}
