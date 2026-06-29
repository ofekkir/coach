import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadFromSource, loadPipelineResult } from './intake.ts';

// A minimal native session log under a temp directory — enough to confirm the
// gather reads it off disk and the pipeline produces a graph from it.
const NATIVE_LOG = JSON.stringify({
  type: 'user',
  sessionId: 's1',
  uuid: 'u1',
  timestamp: '2026-01-01T00:00:00.000Z',
  message: { role: 'user', content: 'hello' },
});

describe('intake', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'coach-intake-'));
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'session.jsonl'), NATIVE_LOG + '\n');
    // Point repo resolution at an empty dir so the repo-name path is deterministic.
    process.env.CLAUDE_PROJECTS_DIR = join(dir, 'sub');
  });

  afterAll(() => {
    delete process.env.CLAUDE_PROJECTS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads every file under a directory and runs the pipeline', () => {
    const result = loadPipelineResult(dir);
    expect(result.classified).toHaveLength(1);
    expect(result.enrichedGraph.kind).toBeDefined();
  });

  it('loadFromSource treats an existing directory as a literal load', () => {
    const { dirs, result } = loadFromSource(dir);
    expect(dirs).toEqual([dir]);
    expect(result.classified).toHaveLength(1);
  });

  it('loadFromSource resolves a non-directory source as a repo name', () => {
    expect(() => loadFromSource('no-such-repo-xyz')).toThrow(/no Claude Code logs found/);
  });
});
