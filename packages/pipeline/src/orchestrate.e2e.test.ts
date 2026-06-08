import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline } from './orchestrate.ts';
import type { UploadedFile } from './types.ts';

const FIXTURES = join(import.meta.dirname, '../fixtures');

function loadFixtureDir(relDir: string): UploadedFile[] {
  const dir = join(FIXTURES, relDir);
  return readdirSync(dir).map((name) => ({
    name,
    content: readFileSync(join(dir, name), 'utf8'),
    path: join(relDir, name),
  }));
}

const FIXTURE_DIRS = [
  'native-claude/fetch-website',
  'native-claude/multi-turn',
  'native-claude/refactor-code',
  'otel/fetch-website',
  'otel/multi-turn-session',
  'otel/update-claude-config',
];

describe('pipeline e2e', () => {
  it.each(FIXTURE_DIRS)('%s — runs without throwing', (dir) => {
    const files = loadFixtureDir(dir);
    expect(() => runPipeline(files)).not.toThrow();
  });
});
