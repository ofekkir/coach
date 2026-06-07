import { useRef, useState } from 'react';
import type { VizResult } from '@coach/pipeline';
import { loadPipelineOutput } from '../../data-source.ts';

const cardStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: '20px 24px',
  background: '#ffffff',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const buttonStyle: React.CSSProperties = {
  background: '#f8fafc',
  color: '#334155',
  border: '1px solid #cbd5e1',
  borderRadius: 7,
  padding: '7px 16px',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: 12,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  padding: '8px 12px',
  margin: 0,
};

export function PipelineOutputLoader({ onResults }: { onResults: (results: VizResult[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setError(null);
        onResults([loadPipelineOutput(reader.result as string, file.name)]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error loading file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '24px 0',
          color: '#94a3b8',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
        or
        <span style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
      </div>
      <div style={cardStyle}>
        <div>
          <p style={{ color: '#334155', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Load pipeline output
          </p>
          <p style={{ color: '#64748b', fontSize: 12, lineHeight: 1.5 }}>
            Load a pre-computed execution graph (e.g. <code>05-execution-graph.json</code> from{' '}
            <code>pnpm e2e</code>) — skips the in-browser pipeline.
          </p>
        </div>
        <div>
          <button
            onClick={() => {
              inputRef.current?.click();
            }}
            style={buttonStyle}
          >
            Choose JSON file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleChange}
          />
        </div>
        {error != null && <p style={errorStyle}>{error}</p>}
      </div>
    </div>
  );
}
