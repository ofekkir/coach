import type { VizResult } from '@coach/pipeline';
import { useRef, useState } from 'react';

import { loadPipelineOutput } from '../../data-source.ts';
import { danger, slate } from '../palette.ts';

const cardStyle: React.CSSProperties = {
  border: `1px solid ${slate.border}`,
  borderRadius: 12,
  padding: '20px 24px',
  background: slate.surface,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const buttonStyle: React.CSSProperties = {
  background: slate.page,
  color: slate.body,
  border: `1px solid ${slate.borderStrong}`,
  borderRadius: 7,
  padding: '7px 16px',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  color: danger.text,
  fontSize: 12,
  background: danger.bg,
  border: `1px solid ${danger.border}`,
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
      <div style={cardStyle}>
        <div>
          <p style={{ color: slate.body, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Load pipeline output
          </p>
          <p style={{ color: slate.muted, fontSize: 12, lineHeight: 1.5 }}>
            Choose an execution-graph JSON file to render.
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
