import { accent, slate } from '../palette.ts';

const buttonStyle: React.CSSProperties = {
  background: slate.divider,
  color: slate.body,
  border: `1px solid ${slate.border}`,
  borderRadius: 7,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

export function DropZone({
  dragOver,
  filesInputRef,
  folderInputRef,
  onDrop,
  onDragOver,
  onDragLeave,
  onFilesChange,
  onFolderChange,
}: {
  dragOver: boolean;
  filesInputRef: React.RefObject<HTMLInputElement>;
  folderInputRef: React.RefObject<HTMLInputElement>;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onFilesChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFolderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      style={{
        border: `2px dashed ${dragOver ? accent.drag : slate.borderStrong}`,
        borderRadius: 12,
        padding: '28px 24px',
        background: dragOver ? accent.dragBg : slate.surface,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 10, textAlign: 'center' }}>📂</div>
      <p
        style={{
          color: slate.label,
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
  );
}
