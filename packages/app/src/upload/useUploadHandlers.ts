import { useCallback, useState } from 'react';
import { processUploads } from '../data-source.ts';
import type { UploadedFile, VizResult } from '@coach/pipeline';

function basenameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

async function readEntryAsFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    all.push(...batch);
  } while (batch.length > 0);
  return all;
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
    const children = await readAllEntries(reader);
    const nested = await Promise.all(children.map((child) => collectEntries(child, entryPath)));
    return nested.flat();
  }
  return [];
}

async function readFilesFromList(fileList: FileList): Promise<UploadedFile[]> {
  return Promise.all(
    Array.from(fileList).map(async (f) => ({
      name: f.name,
      content: await f.text(),
      path: f.name,
    })),
  );
}

async function readFolderFiles(fileList: FileList): Promise<UploadedFile[]> {
  return Promise.all(
    Array.from(fileList).map(async (f) => {
      const relativePath = f.webkitRelativePath || f.name;
      return { name: basenameOf(relativePath), content: await f.text(), path: relativePath };
    }),
  );
}

async function collectFilesFromDrop(items: DataTransferItemList): Promise<UploadedFile[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(items)) {
    const entry = item.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  const collected = (await Promise.all(entries.map((e) => collectEntries(e, '')))).flat();
  return Promise.all(
    collected.map(async ({ file, path }) => ({
      name: basenameOf(path),
      content: await file.text(),
      path,
    })),
  );
}

async function processAndDisplay(
  staged: Map<string, UploadedFile>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  onResults: (results: VizResult[]) => void,
): Promise<void> {
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
}

const FILE_PATTERN = /\.(jsonl|json)$/i;

function stageFiles(
  setStaged: React.Dispatch<React.SetStateAction<Map<string, UploadedFile>>>,
  incoming: UploadedFile[],
): void {
  setStaged((prev) => {
    const next = new Map(prev);
    for (const f of incoming) {
      if (!FILE_PATTERN.test(f.name)) continue;
      const baseKey = f.path ?? f.name;
      let key = baseKey;
      let n = 1;
      while (next.has(key)) key = `${baseKey}__${String(n++)}`;
      next.set(key, f);
    }
    return next;
  });
}

export function useUploadHandlers({
  staged,
  setStaged,
  setError,
  setLoading,
  onResults,
}: {
  staged: Map<string, UploadedFile>;
  setStaged: React.Dispatch<React.SetStateAction<Map<string, UploadedFile>>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  onResults: (results: VizResult[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const onFilesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      void readFilesFromList(fileList).then((files) => {
        stageFiles(setStaged, files);
        e.target.value = '';
      });
    },
    [setStaged],
  );

  const onFolderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      void readFolderFiles(fileList).then((files) => {
        stageFiles(setStaged, files);
        e.target.value = '';
      });
    },
    [setStaged],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      void collectFilesFromDrop(e.dataTransfer.items).then((files) => {
        stageFiles(setStaged, files);
      });
    },
    [setStaged],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const removeStaged = useCallback(
    (key: string) => {
      setStaged((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    },
    [setStaged],
  );

  const onVisualize = useCallback(() => {
    void processAndDisplay(staged, setError, setLoading, onResults);
  }, [staged, setError, setLoading, onResults]);

  return {
    dragOver,
    onFilesChange,
    onFolderChange,
    onDrop,
    onDragOver,
    onDragLeave,
    removeStaged,
    onVisualize,
  };
}
