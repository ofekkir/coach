import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../orchestrate.ts';
import type { UploadedFile } from '../types.ts';
import { buildRecords, materializeSql } from './materialize.ts';
import { normalizeRepoPath } from './repo-path.ts';

const FIXTURES = join(import.meta.dirname, '../../fixtures');

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURES, relPath), 'utf8');
}

const NATIVE_JSONL = readFixture('native-claude/fetch-website/session.jsonl');
const REFACTOR_JSONL = readFixture('native-claude/refactor-code/session.jsonl');

function nodeRows(content: string = NATIVE_JSONL): Record<string, unknown>[] {
  const files: UploadedFile[] = [{ name: 'session.jsonl', content }];
  const { enrichedGraph } = runPipeline(files);
  return buildRecords(enrichedGraph).nodes ?? [];
}

function rowsByInteraction(
  rows: Record<string, unknown>[],
): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const interactionId = row.interaction_id;
    if (typeof interactionId !== 'string') continue;
    const group = groups.get(interactionId) ?? [];
    group.push(row);
    groups.set(interactionId, group);
  }
  return groups;
}

describe('seq invariant', () => {
  it('within each interaction, ORDER BY seq == ORDER BY start_time_ns, dense 0..n-1', () => {
    const groups = rowsByInteraction(nodeRows());
    expect(groups.size).toBeGreaterThan(0);

    for (const rows of groups.values()) {
      const byStartTime = [...rows].sort((a, b) =>
        BigInt(a.start_time_ns as string) < BigInt(b.start_time_ns as string)
          ? -1
          : BigInt(a.start_time_ns as string) > BigInt(b.start_time_ns as string)
            ? 1
            : (a.id as string) < (b.id as string)
              ? -1
              : 1,
      );
      const bySeq = [...rows].sort((a, b) => (a.seq as number) - (b.seq as number));

      expect(bySeq.map((r) => r.id)).toEqual(byStartTime.map((r) => r.id));

      const seqs = rows.map((r) => r.seq as number).sort((a, b) => a - b);
      expect(seqs).toEqual([...Array(rows.length).keys()]);
    }
  });
});

describe('promoted file_path / bash_command columns', () => {
  it("every name='Bash' node carries a non-NULL bash_command", () => {
    const bashRows = nodeRows(REFACTOR_JSONL).filter((r) => r.name === 'Bash');
    expect(bashRows.length).toBeGreaterThan(0);
    const missing = bashRows.filter((r) => r.bash_command == null);
    expect(missing.length).toBe(0);
  });

  it("every name='Read' node carries a non-NULL file_path", () => {
    const readRows = nodeRows(REFACTOR_JSONL).filter((r) => r.name === 'Read');
    expect(readRows.length).toBeGreaterThan(0);
    const missing = readRows.filter((r) => r.file_path == null);
    expect(missing.length).toBe(0);
  });
});

describe('numeric BIGINT time columns', () => {
  it('emits start_time/end_time as bare integer literals matching the ns string digits', () => {
    const rows = nodeRows();
    for (const row of rows) {
      expect(String(row.start_time)).toBe(String(row.start_time_ns));
      expect(String(row.end_time)).toBe(String(row.end_time_ns));
    }
  });

  it('declares the BIGINT columns and emits unquoted integer literals in the DDL/DML', () => {
    const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];
    const { enrichedGraph } = runPipeline(files);
    const sql = materializeSql(enrichedGraph);

    expect(sql.some((s) => s.includes('start_time BIGINT'))).toBe(true);
    expect(sql.some((s) => s.includes('seq INTEGER'))).toBe(true);
  });
});

describe('repo_path worktree normalization invariant', () => {
  const MAIN_CWD = '/Users/ofek/projects/coach';
  const WORKTREE_A = '/Users/ofek/projects/coach/.claude/worktrees/agent-aaaa/src/index.ts';
  const WORKTREE_B = '/Users/ofek/projects/coach/.claude/worktrees/agent-bbbb/src/index.ts';
  const MAIN_FILE = '/Users/ofek/projects/coach/src/index.ts';

  it('collapses the same file under two different worktrees to ONE repo_path', () => {
    const a = normalizeRepoPath(WORKTREE_A, MAIN_CWD);
    const b = normalizeRepoPath(WORKTREE_B, MAIN_CWD);
    expect(a).toBe('src/index.ts');
    expect(a).toBe(b);
  });

  it('a worktree file and the main-checkout file normalize to the same repo_path', () => {
    expect(normalizeRepoPath(WORKTREE_A, MAIN_CWD)).toBe(normalizeRepoPath(MAIN_FILE, MAIN_CWD));
  });

  it('never contains /.claude/worktrees/ and never has a leading /', () => {
    const cwdInWorktree = '/Users/ofek/projects/coach/.claude/worktrees/agent-aaaa';
    for (const out of [
      normalizeRepoPath(WORKTREE_A, MAIN_CWD),
      normalizeRepoPath(WORKTREE_B, cwdInWorktree),
      normalizeRepoPath(MAIN_FILE, MAIN_CWD),
      normalizeRepoPath('/some/other/repo/.claude/worktrees/x/a/b.ts', undefined),
    ]) {
      expect(out).not.toContain('/.claude/worktrees/');
      expect(out?.startsWith('/')).toBe(false);
    }
  });

  it('returns undefined when the tool input carries no file path', () => {
    expect(normalizeRepoPath(undefined, MAIN_CWD)).toBeUndefined();
    expect(normalizeRepoPath('', MAIN_CWD)).toBeUndefined();
  });
});

describe('sessions cwd/branch + nodes.repo_path columns', () => {
  it('declares the session and node columns in the DDL', () => {
    const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];
    const { enrichedGraph } = runPipeline(files);
    const sql = materializeSql(enrichedGraph);
    expect(sql.some((s) => s.includes('cwd VARCHAR'))).toBe(true);
    expect(sql.some((s) => s.includes('branch VARCHAR'))).toBe(true);
    expect(sql.some((s) => s.includes('repo_path VARCHAR'))).toBe(true);
  });

  it('populates sessions.cwd/branch from native session metadata', () => {
    const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];
    const { enrichedGraph } = runPipeline(files);
    const sessions = buildRecords(enrichedGraph).sessions ?? [];
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]?.cwd).toBe('/Users/ofek/projects/coach');
    expect(sessions[0]?.branch).toBe('main');
  });

  it('derives repo_path on tool nodes that touch a file', () => {
    const withRepoPath = nodeRows().filter((r) => typeof r.repo_path === 'string');
    for (const row of withRepoPath) {
      expect(row.repo_path as string).not.toContain('/.claude/worktrees/');
      expect((row.repo_path as string).startsWith('/')).toBe(false);
    }
  });
});
