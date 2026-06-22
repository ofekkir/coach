import type { ClassifiedInput, InputType, UploadedFile } from '../types.ts';

function isOtelTrace(name: string): boolean {
  return name === 'trace.json' || (name.startsWith('trace-') && name.endsWith('.json'));
}

// Why: unrecognised files are marked `unsupported` rather than silently
// dropped, so the count survives to later stages and can be surfaced to the
// caller.
function classifyFile(file: UploadedFile): InputType {
  if (file.name.endsWith('.jsonl')) return 'native';
  if (file.name === 'logs.json') return 'otel-log';
  if (isOtelTrace(file.name)) return 'otel-trace';
  return 'unsupported';
}

export function classifyInputs(files: readonly UploadedFile[]): ClassifiedInput[] {
  return files.map((file) => ({ file, type: classifyFile(file) }));
}
