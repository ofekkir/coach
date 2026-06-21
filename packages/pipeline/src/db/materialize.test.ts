import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../orchestrate.ts';
import type { UploadedFile } from '../types.ts';
import { buildRecords, materializeSql } from './materialize.ts';

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
