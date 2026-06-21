import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../orchestrate.ts';
import type { CanonicalNode, UploadedFile } from '../types.ts';
import type { ExecutionGraph } from '../graph/types.ts';
import { buildRecords, materializeSql } from './materialize.ts';

const FIXTURES = join(import.meta.dirname, '../../fixtures');

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURES, relPath), 'utf8');
}

const NATIVE_JSONL = readFixture('native-claude/fetch-website/session.jsonl');

function nodeRows(): Record<string, unknown>[] {
  const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];
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

// ── cost_usd derivation (native logs carry no cost) ──────────────────────────────

function llmRows(): Record<string, unknown>[] {
  return nodeRows().filter((r) => r.type === 'llm_request');
}

describe('cost_usd derivation', () => {
  it('derives a non-NULL cost_usd for native llm_requests (known model + tokens, no traced cost)', () => {
    const rows = llmRows();
    expect(rows.length).toBeGreaterThan(0);
    // The native fixture uses claude-sonnet-4-6 (priced) and carries no cost_usd.
    for (const row of rows) {
      expect(row.model).toBe('claude-sonnet-4-6');
      expect(typeof row.cost_usd).toBe('number');
      expect(row.cost_usd).not.toBeNull();
    }
  });

  it('INVARIANT: no known-model + tokens row has a NULL cost_usd', () => {
    const KNOWN_MODELS = new Set(['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5']);
    const offenders = llmRows().filter(
      (r) =>
        typeof r.model === 'string' &&
        KNOWN_MODELS.has(r.model) &&
        typeof r.tokens_in === 'number' &&
        typeof r.tokens_out === 'number' &&
        r.cost_usd == null,
    );
    expect(offenders).toEqual([]);
  });

  it('leaves cost_usd NULL for an unknown model and does not throw', () => {
    const node: CanonicalNode = {
      id: 'llm-unknown',
      type: 'llm_request',
      sessionId: 'session-s',
      interactionId: 'i',
      model: 'some-unknown-model',
      tokens_in: 1000,
      tokens_out: 500,
      start_time_ns: '0',
      end_time_ns: '1',
      duration_ms: 1,
    };
    const graph: ExecutionGraph = {
      kind: 'interaction',
      data: null,
      nodes: { [node.id]: node },
      deltas: {},
      semantics: {},
      actions: {},
      intents: {},
    };
    // cost_usd is read straight off the node (no traced cost, unknown model → undefined → NULL).
    const records = buildRecords(graph);
    const row = (records.nodes ?? []).find((r) => r.id === 'llm-unknown');
    expect(row?.cost_usd).toBeUndefined();
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
