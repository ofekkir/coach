const btnStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  color: '#475569',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 500,
  padding: '5px 10px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
};

export function Toolbar({
  title,
  onExpandAll,
  onCollapseAll,
}: {
  title: string;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          color: '#94a3b8',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={btnStyle} onClick={onExpandAll}>
          Expand all
        </button>
        <button style={btnStyle} onClick={onCollapseAll}>
          Collapse all
        </button>
      </div>
    </div>
  );
}
