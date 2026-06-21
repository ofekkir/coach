import type { VizResult } from '@coach/pipeline';
import { PipelineOutputLoader } from './PipelineOutputLoader/PipelineOutputLoader.tsx';
import { slate } from './palette.ts';

interface Props {
  onResults: (results: VizResult[]) => void;
}

function renderHeader(): React.ReactNode {
  return (
    <div style={{ textAlign: 'center', marginBottom: 32 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: slate.faint,
          marginBottom: 12,
        }}
      >
        Coach
      </div>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: slate.heading,
          marginBottom: 8,
          lineHeight: 1.3,
        }}
      >
        Trace Viewer
      </h1>
      <p style={{ color: slate.muted, fontSize: 13, lineHeight: 1.6 }}>
        Load a pre-computed execution graph produced by the coach pipeline (e.g.{' '}
        <code>05-execution-graph.json</code> from <code>pnpm e2e</code>).
      </p>
    </div>
  );
}

export function UploadPage({ onResults }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        minHeight: '100vh',
        background: slate.page,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '32px 0',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: '100%', maxWidth: 540, padding: '0 24px' }}>
        {renderHeader()}
        <PipelineOutputLoader onResults={onResults} />
      </div>
    </div>
  );
}
