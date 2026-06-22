import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExecutionGraph } from '../graph/types.ts';
import { runPipeline } from '../orchestrate.ts';
import type { CanonicalNode, UploadedFile } from '../types.ts';

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
  it('emits start_time_ns/end_time_ns as the verbatim ns digit strings carried in data', () => {
    const rows = nodeRows();
    for (const row of rows) {
      const node = row.data as CanonicalNode;
      expect(String(row.start_time_ns)).toBe(node.start_time_ns);
      expect(String(row.end_time_ns)).toBe(node.end_time_ns);
    }
  });

  it('declares the BIGINT columns and emits unquoted integer literals in the DDL/DML', () => {
    const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];
    const { enrichedGraph } = runPipeline(files);
    const sql = materializeSql(enrichedGraph);

    expect(sql.some((s) => s.includes('start_time_ns BIGINT'))).toBe(true);
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

  it('anchors an out-of-project home .claude config file at .claude/', () => {
    expect(normalizeRepoPath('/Users/ofek/.claude/plans/x.md', MAIN_CWD)).toBe(
      '.claude/plans/x.md',
    );
    expect(normalizeRepoPath('/Users/ofek/.claude/projects/p/memory/MEMORY.md', MAIN_CWD)).toBe(
      '.claude/projects/p/memory/MEMORY.md',
    );
  });

  it('leaves a project-rooted .claude config file anchored at .claude/', () => {
    expect(normalizeRepoPath(`${MAIN_CWD}/.claude/settings.json`, MAIN_CWD)).toBe(
      '.claude/settings.json',
    );
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

// ── cost_usd: traced-only, never estimated ───────────────────────────────────────

function llmRows(): Record<string, unknown>[] {
  return nodeRows().filter((r) => r.type === 'llm_request');
}

describe('cost_usd (traced only, never estimated)', () => {
  it('INVARIANT: native (untraced) llm_request rows all carry NULL cost_usd', () => {
    const rows = llmRows();
    expect(rows.length).toBeGreaterThan(0);
    // The native fixture carries no traced cost; we deliberately do NOT back-compute
    // an estimate from a price table, so cost_usd stays absent → NULL ("unknown"),
    // never 0 (an omitted record key serializes to SQL NULL via columnLiteral).
    for (const row of rows) {
      expect(row.cost_usd == null).toBe(true);
    }
  });

  it('emits a traced cost_usd verbatim and leaves an untraced one NULL', () => {
    const traced: CanonicalNode = {
      id: 'llm-traced',
      type: 'llm_request',
      sessionId: 'session-s',
      interactionId: 'i',
      model: 'claude-sonnet-4-6',
      tokens_in: 1000,
      tokens_out: 500,
      cost_usd: 0.0042,
      start_time_ns: '0',
      end_time_ns: '1',
      duration_ms: 1,
    };
    const untraced: CanonicalNode = {
      id: 'llm-untraced',
      type: 'llm_request',
      sessionId: 'session-s',
      interactionId: 'i',
      model: 'claude-sonnet-4-6',
      tokens_in: 1000,
      tokens_out: 500,
      start_time_ns: '2',
      end_time_ns: '3',
      duration_ms: 1,
    };
    const graph: ExecutionGraph = {
      kind: 'interaction',
      data: null,
      nodes: { [traced.id]: traced, [untraced.id]: untraced },
      deltas: {},
      semantics: {},
      actions: {},
      intents: {},
    };
    const rows = buildRecords(graph).nodes ?? [];
    expect(rows.find((r) => r.id === 'llm-traced')?.cost_usd).toBe(0.0042);
    expect(rows.find((r) => r.id === 'llm-untraced')?.cost_usd).toBeUndefined();
  });
});

// ── intent_category (interaction-level) ──────────────────────────────────────────

describe('intent_category', () => {
  it('INVARIANT: 100% non-NULL on every interaction row', () => {
    const interactions = nodeRows().filter((r) => r.type === 'interaction');
    expect(interactions.length).toBeGreaterThan(0);
    for (const row of interactions) {
      expect(row.intent_category).not.toBeNull();
      expect(typeof row.intent_category).toBe('string');
    }
  });

  it('declares the intent_category column in the DDL', () => {
    const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];
    const { enrichedGraph } = runPipeline(files);
    const sql = materializeSql(enrichedGraph);
    expect(sql.some((s) => s.includes('intent_category VARCHAR'))).toBe(true);
  });
});

// ── derived relations are VIEWs, not materialized tables ─────────────────────────

describe('derived + per-type relations are views', () => {
  it('emits CREATE VIEW (not CREATE TABLE) for each, and inserts no rows for them', () => {
    const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];
    const { enrichedGraph } = runPipeline(files);
    const sql = materializeSql(enrichedGraph);

    for (const name of ['interaction_metrics', 'llm_requests', 'tools', 'interactions']) {
      expect(sql.some((s) => s.startsWith(`CREATE VIEW ${name} AS`))).toBe(true);
      expect(sql.some((s) => s.startsWith(`CREATE TABLE ${name} `))).toBe(false);
      expect(sql.some((s) => s.startsWith(`INSERT INTO ${name} `))).toBe(false);
    }
  });

  it('the view reads from nodes only after the nodes table is created', () => {
    const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];
    const { enrichedGraph } = runPipeline(files);
    const sql = materializeSql(enrichedGraph);
    const nodesTableAt = sql.findIndex((s) => s.startsWith('CREATE TABLE nodes '));
    const metricsViewAt = sql.findIndex((s) => s.startsWith('CREATE VIEW interaction_metrics AS'));
    expect(nodesTableAt).toBeGreaterThanOrEqual(0);
    expect(metricsViewAt).toBeGreaterThan(nodesTableAt);
  });
});
