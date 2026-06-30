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

// Read the cwd straight from the fixture so the assertion stays free of any
// machine-specific path literal.
function fixtureCwd(jsonl: string): string | undefined {
  for (const line of jsonl.split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as { cwd?: unknown };
    if (typeof row.cwd === 'string') return row.cwd;
  }
  return undefined;
}

function records(content: string = NATIVE_JSONL): Record<string, Record<string, unknown>[]> {
  const files: UploadedFile[] = [{ name: 'session.jsonl', content }];
  // The DB materializes the stage-7 RESOLVED graph (semantics entries grounded with
  // repo_path/package), so tests read the same graph the store does.
  return buildRecords(runPipeline(files).resolvedGraph);
}

function nodeRows(content: string = NATIVE_JSONL): Record<string, unknown>[] {
  return records(content).nodes ?? [];
}

function semanticsRows(content: string = NATIVE_JSONL): Record<string, unknown>[] {
  return records(content).semantics ?? [];
}

function resolvedSql(content: string = NATIVE_JSONL): string[] {
  const files: UploadedFile[] = [{ name: 'session.jsonl', content }];
  return materializeSql(runPipeline(files).resolvedGraph);
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

describe('promoted bash_command + per-entry repo_path', () => {
  it("every name='Bash' node carries a non-NULL bash_command", () => {
    const bashRows = nodeRows(REFACTOR_JSONL).filter((r) => r.name === 'Bash');
    expect(bashRows.length).toBeGreaterThan(0);
    const missing = bashRows.filter((r) => r.bash_command == null);
    expect(missing.length).toBe(0);
  });

  it("every name='Read' node has a semantics entry carrying its repo_path", () => {
    const readIds = new Set(
      nodeRows(REFACTOR_JSONL)
        .filter((r) => r.name === 'Read')
        .map((r) => r.id),
    );
    expect(readIds.size).toBeGreaterThan(0);
    const readEntries = semanticsRows(REFACTOR_JSONL).filter((r) => readIds.has(r.id));
    const missing = readEntries.filter((r) => r.repo_path == null);
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
    const sql = resolvedSql();
    expect(sql.some((s) => s.includes('start_time_ns BIGINT'))).toBe(true);
    expect(sql.some((s) => s.includes('seq INTEGER'))).toBe(true);
  });
});

describe('repo_path worktree normalization invariant', () => {
  const MAIN_CWD = '/Users/dev/projects/coach';
  const WORKTREE_A = '/Users/dev/projects/coach/.claude/worktrees/agent-aaaa/src/index.ts';
  const WORKTREE_B = '/Users/dev/projects/coach/.claude/worktrees/agent-bbbb/src/index.ts';
  const MAIN_FILE = '/Users/dev/projects/coach/src/index.ts';

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
    const cwdInWorktree = '/Users/dev/projects/coach/.claude/worktrees/agent-aaaa';
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
    expect(normalizeRepoPath('/Users/dev/.claude/plans/x.md', MAIN_CWD)).toBe('.claude/plans/x.md');
    expect(normalizeRepoPath('/Users/dev/.claude/projects/p/memory/MEMORY.md', MAIN_CWD)).toBe(
      '.claude/projects/p/memory/MEMORY.md',
    );
  });

  it('leaves a project-rooted .claude config file anchored at .claude/', () => {
    expect(normalizeRepoPath(`${MAIN_CWD}/.claude/settings.json`, MAIN_CWD)).toBe(
      '.claude/settings.json',
    );
  });
});

describe('sessions cwd/branch + semantics.repo_path columns', () => {
  it('declares the session and semantics columns in the DDL', () => {
    const sql = resolvedSql();
    expect(sql.some((s) => s.includes('cwd VARCHAR'))).toBe(true);
    expect(sql.some((s) => s.includes('branch VARCHAR'))).toBe(true);
    expect(sql.some((s) => s.includes('repo_path VARCHAR'))).toBe(true);
  });

  it('populates sessions.cwd/branch from native session metadata', () => {
    const sessions = records().sessions ?? [];
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]?.cwd).toBe(fixtureCwd(NATIVE_JSONL));
    expect(sessions[0]?.branch).toBe('main');
  });

  it('grounds repo_path on semantics entries that touched a file', () => {
    const withRepoPath = semanticsRows(REFACTOR_JSONL).filter(
      (r) => typeof r.repo_path === 'string',
    );
    expect(withRepoPath.length).toBeGreaterThan(0);
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
      cache_read_tokens: 0,
      cache_write_tokens: 0,
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
      cache_read_tokens: 0,
      cache_write_tokens: 0,
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
    expect(resolvedSql().some((s) => s.includes('intent_category VARCHAR'))).toBe(true);
  });
});

// ── derived relations are VIEWs, not materialized tables ─────────────────────────

describe('derived + per-type relations are views', () => {
  it('emits CREATE VIEW (not CREATE TABLE) for each, and inserts no rows for them', () => {
    const sql = resolvedSql();

    for (const name of ['interaction_metrics', 'llm_requests', 'tools', 'interactions']) {
      expect(sql.some((s) => s.startsWith(`CREATE VIEW ${name} AS`))).toBe(true);
      expect(sql.some((s) => s.startsWith(`CREATE TABLE ${name} `))).toBe(false);
      expect(sql.some((s) => s.startsWith(`INSERT INTO ${name} `))).toBe(false);
    }
  });

  it('the view reads from nodes only after the nodes table is created', () => {
    const sql = resolvedSql();
    const nodesTableAt = sql.findIndex((s) => s.startsWith('CREATE TABLE nodes '));
    const metricsViewAt = sql.findIndex((s) => s.startsWith('CREATE VIEW interaction_metrics AS'));
    expect(nodesTableAt).toBeGreaterThanOrEqual(0);
    expect(metricsViewAt).toBeGreaterThan(nodesTableAt);
  });
});
