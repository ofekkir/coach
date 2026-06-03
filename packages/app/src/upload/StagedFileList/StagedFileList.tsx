import type { UploadedFile } from '@coach/pipeline';

const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: '2px 6px',
  fontSize: 11,
  cursor: 'pointer',
};

function dirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

function renderVisualizeFooter(
  loading: boolean,
  count: number,
  onVisualize: () => void,
): React.ReactNode {
  return (
    <div style={{ padding: '10px 14px', borderTop: '1px solid #f1f5f9' }}>
      <button
        onClick={onVisualize}
        disabled={loading}
        style={{
          width: '100%',
          background: loading ? '#94a3b8' : '#1e293b',
          color: '#ffffff',
          border: 'none',
          borderRadius: 7,
          padding: '9px 0',
          fontSize: 13,
          fontWeight: 600,
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? 'Processing…' : `Visualize ${String(count)} file${count !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}

function renderFileRow(key: string, name: string, onRemove: (k: string) => void): React.ReactNode {
  return (
    <div
      key={key}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '5px 14px',
        borderBottom: '1px solid #f8fafc',
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: '#334155',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      <button
        onClick={() => {
          onRemove(key);
        }}
        style={{ ...ghostButtonStyle, color: '#94a3b8', flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
}

export function StagedFileList({
  stagedEntries,
  loading,
  onClearAll,
  onRemove,
  onVisualize,
}: {
  stagedEntries: [string, UploadedFile][];
  loading: boolean;
  onClearAll: () => void;
  onRemove: (key: string) => void;
  onVisualize: () => void;
}) {
  const dirGroups = stagedEntries.reduce<Map<string, [string, UploadedFile][]>>((acc, [key, f]) => {
    const dir = dirOf(f.path ?? '') || '(root)';
    const group = acc.get(dir) ?? [];
    group.push([key, f]);
    acc.set(dir, group);
    return acc;
  }, new Map());

  return (
    <div
      style={{
        marginTop: 16,
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        background: '#ffffff',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
          {stagedEntries.length} file{stagedEntries.length !== 1 ? 's' : ''} staged
        </span>
        <button onClick={onClearAll} style={{ ...ghostButtonStyle, color: '#94a3b8' }}>
          Clear all
        </button>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {[...dirGroups.entries()].map(([dir, entries]) => (
          <div key={dir}>
            {dir !== '(root)' && (
              <div
                style={{
                  padding: '4px 14px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: '#94a3b8',
                  background: '#f8fafc',
                }}
              >
                {dir}
              </div>
            )}
            {entries.map(([key, f]) => renderFileRow(key, f.name, onRemove))}
          </div>
        ))}
      </div>
      {renderVisualizeFooter(loading, stagedEntries.length, onVisualize)}
    </div>
  );
}
