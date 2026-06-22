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

  // Guards the full tool_use_id plumbing → causal builder for BOTH input formats:
  // native (span attr stamped by the native builder) and OTEL (attr enriched onto
  // the tool span from its decision log). A session with tool calls must yield
  // causal edges either way — this is the harness-agnostic promise.
  it.each(['native-claude/refactor-code', 'otel/update-claude-config'])(
    '%s — derives causal edges end-to-end',
    (dir) => {
      const graph = runPipeline(loadFixtureDir(dir)).enrichedGraph;
      if (graph.kind !== 'agent') throw new Error('expected agent graph');
      const causal = graph.data.sessions.flatMap((s) =>
        s.interactions.flatMap((i) => i.causalEdges),
      );
      expect(causal.length).toBeGreaterThan(0);
      expect(causal.every((e) => e.fromId !== e.toId)).toBe(true);
    },
  );
});
