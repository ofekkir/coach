import { colorOf } from '../layout/colors.ts';

// A value longer than this renders in a boxed, monospaced block instead of inline.
const LONG_VALUE_CHARS = 80;
const LONG_VALUE_RADIUS = 6;

function renderDetailRow(line: string, i: number): React.ReactNode {
  const colon = line.indexOf(':');
  const key = colon > 0 ? line.slice(0, colon) : null;
  const val = colon > 0 ? line.slice(colon + 1).trim() : line;
  const isLong = val.length > LONG_VALUE_CHARS;
  return (
    <div key={i} style={{ marginBottom: 12 }}>
      {key !== null && (
        <div
          style={{
            color: '#94a3b8',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 3,
          }}
        >
          {key}
        </div>
      )}
      <div
        style={{
          color: '#374151',
          fontSize: 11,
          fontFamily: isLong ? 'monospace' : 'system-ui, sans-serif',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: isLong ? '#f8fafc' : 'transparent',
          borderRadius: isLong ? LONG_VALUE_RADIUS : 0,
          padding: isLong ? '6px 8px' : 0,
          border: isLong ? '1px solid #e2e8f0' : 'none',
          maxHeight: 200,
          overflowY: 'auto',
        }}
      >
        {val}
      </div>
    </div>
  );
}

export function DetailsPanel({
  labelLines,
  onClose,
}: {
  labelLines: readonly string[];
  onClose: () => void;
}) {
  const type = labelLines[0] ?? '';
  const color = colorOf(type);

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
          {type.toUpperCase()}
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
        {labelLines.slice(1).map(renderDetailRow)}
      </div>
    </div>
  );
}
