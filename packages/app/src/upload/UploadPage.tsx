import type { UploadedFile, VizResult } from '@coach/pipeline';
import { useEffect, useRef, useState } from 'react';

import { DropZone } from './DropZone/DropZone.tsx';
import { danger, slate } from './palette.ts';
import { PipelineOutputLoader } from './PipelineOutputLoader/PipelineOutputLoader.tsx';
import { StagedFileList } from './StagedFileList/StagedFileList.tsx';
import { useUploadHandlers } from './useUploadHandlers.ts';

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
        Upload native Claude Code session logs (<code>.jsonl</code>) or OTEL sets (
        <code>logs.json</code> + <code>trace*.json</code>). Add multiple files or folders — all
        sessions roll up into one agent view.
      </p>
    </div>
  );
}

export function UploadPage({ onResults }: Props) {
  const [staged, setStaged] = useState<Map<string, UploadedFile>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const {
    dragOver,
    onFilesChange,
    onFolderChange,
    onDrop,
    onDragOver,
    onDragLeave,
    removeStaged,
    onVisualize,
  } = useUploadHandlers({ staged, setStaged, setError, setLoading, onResults });

  const stagedEntries = [...staged.entries()];

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
        <DropZone
          dragOver={dragOver}
          filesInputRef={filesInputRef}
          folderInputRef={folderInputRef}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onFilesChange={onFilesChange}
          onFolderChange={onFolderChange}
        />
        {stagedEntries.length > 0 && (
          <StagedFileList
            stagedEntries={stagedEntries}
            loading={loading}
            onClearAll={() => {
              setStaged(new Map());
            }}
            onRemove={removeStaged}
            onVisualize={onVisualize}
          />
        )}
        {error != null && (
          <p
            style={{
              marginTop: 16,
              color: danger.text,
              fontSize: 12,
              background: danger.bg,
              border: `1px solid ${danger.border}`,
              borderRadius: 6,
              padding: '8px 12px',
            }}
          >
            {error}
          </p>
        )}
        <PipelineOutputLoader onResults={onResults} />
      </div>
    </div>
  );
}
