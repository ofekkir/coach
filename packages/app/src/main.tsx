import { ReactFlowProvider } from '@xyflow/react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './viz/App.tsx';
import { UploadPage } from './upload/UploadPage.tsx';
import type { VizResult } from '@coach/pipeline';

// ── result selector (shown when multiple artifacts are produced) ───────────────

function ResultSelector({
  results,
  selectedIdx,
  onSelect,
}: {
  results: VizResult[];
  selectedIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        gap: 6,
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        padding: '6px 8px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {results.map((r, i) => (
        <button
          key={i}
          onClick={() => {
            onSelect(i);
          }}
          style={{
            background: i === selectedIdx ? '#1e293b' : 'transparent',
            color: i === selectedIdx ? '#ffffff' : '#64748b',
            border: 'none',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {r.title}
        </button>
      ))}
    </div>
  );
}

// ── root ──────────────────────────────────────────────────────────────────────

function Root() {
  const [results, setResults] = useState<VizResult[] | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  if (results == null) {
    return <UploadPage onResults={setResults} />;
  }

  const result = results[selectedIdx] ?? results[0];
  if (result == null) return null;

  return (
    <>
      {/* key forces App to remount when selection changes, resetting expanded state */}
      <App key={selectedIdx} data={result.data} title={result.title} />
      {results.length > 1 && (
        <ResultSelector results={results} selectedIdx={selectedIdx} onSelect={setSelectedIdx} />
      )}
    </>
  );
}

const root = document.getElementById('root');
if (root == null) throw new Error('No #root element');

createRoot(root).render(
  <StrictMode>
    <ReactFlowProvider>
      <Root />
    </ReactFlowProvider>
  </StrictMode>,
);
