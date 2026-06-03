import { describe, expect, it } from 'vitest';
import type { UploadedFile } from '../types.ts';
import { classifyInputs } from './classify.ts';

function file(name: string): UploadedFile {
  return { name, content: '' };
}

describe('classifyInputs', () => {
  it('classifies each input by filename convention', () => {
    const result = classifyInputs([
      file('session.jsonl'),
      file('logs.json'),
      file('trace.json'),
      file('trace-abc123.json'),
      file('README.md'),
    ]);

    expect(result.map((r) => r.type)).toEqual([
      'native',
      'otel-log',
      'otel-trace',
      'otel-trace',
      'unsupported',
    ]);
  });

  it('preserves the original file on each classified input', () => {
    const f = file('session.jsonl');
    expect(classifyInputs([f])[0]?.file).toBe(f);
  });
});
