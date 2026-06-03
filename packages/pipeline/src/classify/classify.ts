import type { ClassifiedInput, InputType, UploadedFile } from '../types.ts';

function isOtelTrace(name: string): boolean {
  return name === 'trace.json' || (name.startsWith('trace-') && name.endsWith('.json'));
}

// Classifies a single file by filename convention. Anything unrecognised is
// marked `unsupported` rather than silently dropped, so the count survives to
// later stages and can be surfaced to the caller.
function classifyFile(file: UploadedFile): InputType {
  if (file.name.endsWith('.jsonl')) return 'native';
  if (file.name === 'logs.json') return 'otel-log';
  if (isOtelTrace(file.name)) return 'otel-trace';
  return 'unsupported';
}

// Stage 1: tag every uploaded file with its input type.
export function classifyInputs(files: readonly UploadedFile[]): ClassifiedInput[] {
  return files.map((file) => ({ file, type: classifyFile(file) }));
}
