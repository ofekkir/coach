import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveRepoDirs, type ResolvedRepo } from './resolve-dataset.ts';

// A fake ~/.claude/projects holding one repo with two worktrees, an unrelated
// repo, and a repo whose name is a suffix of another — enough to exercise the
// worktree fold, the include flag, and the not-found / ambiguity paths.
const PROJECT_DIRS = [
  '-Users-ofek-projects-coach',
  '-Users-ofek-projects-coach--claude-worktrees-add-search',
  '-Users-ofek-projects-coach--claude-worktrees-fix-delta',
  '-Users-ofek-projects-other',
];

describe('resolveRepoDirs', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'coach-projects-'));
    process.env.CLAUDE_PROJECTS_DIR = root;
    PROJECT_DIRS.forEach((dir) => {
      mkdirSync(join(root, dir));
    });
  });

  afterAll(() => {
    delete process.env.CLAUDE_PROJECTS_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it('folds in every worktree by default when resolving by name', () => {
    const resolved: ResolvedRepo = resolveRepoDirs('coach');
    expect(resolved.dirs.map((d) => basename(d))).toEqual([
      '-Users-ofek-projects-coach',
      '-Users-ofek-projects-coach--claude-worktrees-add-search',
      '-Users-ofek-projects-coach--claude-worktrees-fix-delta',
    ]);
  });

  it('returns only the main checkout when worktrees are excluded', () => {
    const resolved = resolveRepoDirs('coach', { includeWorktrees: false });
    expect(resolved.dirs.map((d) => basename(d))).toEqual(['-Users-ofek-projects-coach']);
  });

  it('resolves by absolute repo path', () => {
    const resolved = resolveRepoDirs('/Users/ofek/projects/coach');
    expect(resolved.repoKey).toBe('-Users-ofek-projects-coach');
    expect(resolved.dirs).toHaveLength(3);
  });

  it('throws a clear message when no repo matches', () => {
    expect(() => resolveRepoDirs('nonexistent')).toThrow(/no Claude Code logs found/);
  });
});
