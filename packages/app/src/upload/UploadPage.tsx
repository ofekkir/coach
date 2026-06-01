import { useCallback, useRef, useState } from 'react';
import { processUploads } from '../data-source.ts';
import type { UploadedFile, VizResult } from '@coach/pipeline';

interface Props {
  onResults: (results: VizResult[]) => void;
}

const ACCEPTED = '.jsonl,.json';

export function UploadPage({ onResults }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const process = useCallback(
    async (fileList: FileList) => {
      setError(null);
      setLoading(true);
      try {
        const uploaded: UploadedFile[] = await Promise.all(
          Array.from(fileList).map(async (f) => ({ name: f.name, content: await f.text() })),
        );
        const results = await processUploads(uploaded);
        if (results.length === 0) {
          setError('No visualisable data found in the uploaded files.');
          return;
        }
        onResults(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Processing failed.');
      } finally {
        setLoading(false);
      }
    },
    [onResults],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) void process(files);
    },
    [process],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) void process(e.dataTransfer.files);
    },
    [process],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        height: '100vh',
        background: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 480, padding: '0 24px' }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#94a3b8',
            marginBottom: 12,
          }}
        >
          Coach
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: '#1e293b',
            marginBottom: 8,
            lineHeight: 1.3,
          }}
        >
          Trace Viewer
        </h1>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 32, lineHeight: 1.6 }}>
          Upload native Claude Code session logs (<code>.jsonl</code>) or an OTEL set (
          <code>logs.json</code> + <code>trace*.json</code>).
        </p>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          style={{
            border: '2px dashed #cbd5e1',
            borderRadius: 12,
            padding: '36px 24px',
            cursor: loading ? 'wait' : 'pointer',
            transition: 'border-color 0.15s',
            background: '#ffffff',
          }}
          onClick={() => {
            if (!loading) inputRef.current?.click();
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            style={{ display: 'none' }}
            onChange={onChange}
          />
          {loading ? (
            <p style={{ color: '#64748b', fontSize: 13 }}>Processing…</p>
          ) : (
            <>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📂</div>
              <p style={{ color: '#475569', fontSize: 13, fontWeight: 500 }}>
                Drop files here or click to browse
              </p>
              <p style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>
                Select multiple files for multi-trace sessions
              </p>
            </>
          )}
        </div>

        {error != null && (
          <p
            style={{
              marginTop: 16,
              color: '#dc2626',
              fontSize: 12,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              padding: '8px 12px',
            }}
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
