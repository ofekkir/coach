import { useCallback, useEffect, useRef, useState } from 'react';
import { processUploads } from '../data-source.ts';
import type { UploadedFile, VizResult } from '@coach/pipeline';

interface Props {
  onResults: (results: VizResult[]) => void;
}

const FILE_PATTERN = /\.(jsonl|json)$/i;

function basenameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

async function readEntryAsFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function collectEntries(
  entry: FileSystemEntry,
  parentPath: string,
): Promise<{ file: File; path: string }[]> {
  const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await readEntryAsFile(entry as FileSystemFileEntry);
    return [{ file, path: entryPath }];
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const collected: { file: File; path: string }[] = [];
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      for (const child of batch) {
        collected.push(...(await collectEntries(child, entryPath)));
      }
    } while (batch.length > 0);
    return collected;
  }
  return [];
}

export function UploadPage({ onResults }: Props) {
  const [staged, setStaged] = useState<Map<string, UploadedFile>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // webkitdirectory is not in React's InputHTMLAttributes; set it imperatively.
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  function addToStaged(incoming: UploadedFile[]) {
    setStaged((prev) => {
      const next = new Map(prev);
      for (const f of incoming) {
        if (FILE_PATTERN.test(f.name)) {
          next.set(f.path ?? f.name, f);
        } else {
          console.debug('[coach] skipped non-JSON/JSONL file:', f.path ?? f.name);
        }
      }
      return next;
    });
  }

  const onFilesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    void (async () => {
      const uploaded = await Promise.all(
        Array.from(fileList).map(async (f) => ({
          name: f.name,
          content: await f.text(),
          path: f.name,
        })),
      );
      addToStaged(uploaded);
      e.target.value = '';
    })();
  }, []);

  const onFolderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    void (async () => {
      const uploaded = await Promise.all(
        Array.from(fileList).map(async (f) => {
          const relativePath = f.webkitRelativePath || f.name;
          return {
            name: basenameOf(relativePath),
            content: await f.text(),
            path: relativePath,
          };
        }),
      );
      addToStaged(uploaded);
      e.target.value = '';
    })();
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    // Collect all DataTransferItem entries synchronously before any await.
    const entries: FileSystemEntry[] = [];
    for (const item of Array.from(e.dataTransfer.items)) {
      const entry = item.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    void (async () => {
      const collected = (
        await Promise.all(entries.map((entry) => collectEntries(entry, '')))
      ).flat();
      const uploaded = await Promise.all(
        collected.map(async ({ file, path }) => ({
          name: basenameOf(path),
          content: await file.text(),
          path,
        })),
      );
      addToStaged(uploaded);
    })();
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  function removeStaged(key: string) {
    setStaged((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }

  const onVisualize = useCallback(() => {
    void (async () => {
      setError(null);
      setLoading(true);
      try {
        const uploadedFiles = [...staged.values()];
        if (uploadedFiles.length === 0) {
          setError('No visualisable data found in the uploaded files.');
          return;
        }
        const results = await processUploads(uploadedFiles);
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
    })();
  }, [staged, onResults]);

  const stagedEntries = [...staged.entries()];

  const dirGroups = stagedEntries.reduce<Map<string, string[]>>((acc, [key]) => {
    const dir = dirOf(key) || '(root)';
    const group = acc.get(dir) ?? [];
    group.push(key);
    acc.set(dir, group);
    return acc;
  }, new Map());

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        minHeight: '100vh',
        background: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '32px 0',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: '100%', maxWidth: 540, padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
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
          <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>
            Upload native Claude Code session logs (<code>.jsonl</code>) or OTEL sets (
            <code>logs.json</code> + <code>trace*.json</code>). Add multiple files or folders — all
            sessions roll up into one agent view.
          </p>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          style={{
            border: `2px dashed ${dragOver ? '#6366f1' : '#cbd5e1'}`,
            borderRadius: 12,
            padding: '28px 24px',
            background: dragOver ? '#eef2ff' : '#ffffff',
            transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 10, textAlign: 'center' }}>📂</div>
          <p
            style={{
              color: '#475569',
              fontSize: 13,
              fontWeight: 500,
              textAlign: 'center',
              marginBottom: 16,
            }}
          >
            Drop files or folders here, or use the buttons below
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                filesInputRef.current?.click();
              }}
              style={buttonStyle}
            >
              Add files
            </button>
            <button
              onClick={() => {
                folderInputRef.current?.click();
              }}
              style={buttonStyle}
            >
              Add folder
            </button>
          </div>
          <input
            ref={filesInputRef}
            type="file"
            accept=".jsonl,.json"
            multiple
            style={{ display: 'none' }}
            onChange={onFilesChange}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={onFolderChange}
          />
        </div>

        {stagedEntries.length > 0 && (
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
              <button
                onClick={() => {
                  setStaged(new Map());
                }}
                style={{ ...ghostButtonStyle, color: '#94a3b8' }}
              >
                Clear all
              </button>
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {[...dirGroups.entries()].map(([dir, keys]) => (
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
                  {keys.map((key) => (
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
                        {basenameOf(key)}
                      </span>
                      <button
                        onClick={() => {
                          removeStaged(key);
                        }}
                        style={{ ...ghostButtonStyle, color: '#94a3b8', flexShrink: 0 }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
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
                {loading
                  ? 'Processing…'
                  : `Visualize ${String(stagedEntries.length)} file${stagedEntries.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

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

const buttonStyle: React.CSSProperties = {
  background: '#f1f5f9',
  color: '#334155',
  border: '1px solid #e2e8f0',
  borderRadius: 7,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: '2px 6px',
  fontSize: 11,
  cursor: 'pointer',
};
