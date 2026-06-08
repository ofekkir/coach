const LINE: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

// Gap (px) under the name line when detail lines follow it.
const NAME_GAP_WITH_DETAILS = 2;

export function NodeBody({
  name,
  details,
  timing,
  color,
}: {
  name: string;
  details: string[];
  timing: string | null;
  color: string;
}) {
  return (
    <div style={{ padding: '6px 10px 8px' }}>
      {name !== '' && (
        <div
          style={{
            ...LINE,
            color: '#1e293b',
            fontSize: 11,
            lineHeight: 1.4,
            marginBottom: details.length > 0 ? NAME_GAP_WITH_DETAILS : 0,
          }}
        >
          {name}
        </div>
      )}
      {details.map((line, i) => (
        <div
          key={i}
          style={{ ...LINE, color: '#64748b', fontSize: 10, lineHeight: 1.45, marginTop: 1 }}
        >
          {line}
        </div>
      ))}
      {timing !== null && (
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
          {timing}
        </div>
      )}
    </div>
  );
}
