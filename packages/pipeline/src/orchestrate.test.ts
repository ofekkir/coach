import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_AGENT_ID } from './etl/aggregate.ts';
import { buildVizResults } from './orchestrate.ts';
import type { UploadedFile } from './orchestrate.ts';

const FIXTURES = join(import.meta.dirname, '../fixtures');

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURES, relPath), 'utf8');
}

const OTEL_A_LOGS = readFixture('otel/fetch-website/logs.json');
const OTEL_A_TRACE = readFixture('otel/fetch-website/trace.json');
const OTEL_B_LOGS = readFixture('otel/update-claude-config/logs.json');
const OTEL_B_TRACE = readFixture('otel/update-claude-config/trace.json');
const NATIVE_JSONL = readFixture('native-claude/fetch-website/session.jsonl');

describe('buildVizResults', () => {
  it('two OTEL directories produce independent sessions under one agent', () => {
    const files: UploadedFile[] = [
      { name: 'logs.json', content: OTEL_A_LOGS, path: 'projA/logs.json' },
      { name: 'trace.json', content: OTEL_A_TRACE, path: 'projA/trace.json' },
      { name: 'logs.json', content: OTEL_B_LOGS, path: 'projB/logs.json' },
      { name: 'trace.json', content: OTEL_B_TRACE, path: 'projB/trace.json' },
    ];

    const results = buildVizResults(files);

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result?.data.kind).toBe('agent');

    // Both sessions must appear — no cross-contamination means no deduplication
    // that silently drops one session.
    const agentView = result?.data.kind === 'agent' ? result.data.data : null;
    expect(agentView?.sessions).toHaveLength(2);
  });

  it('OTEL files from different dirs do not share logs across directories', () => {
    // projA has valid logs+trace; projB has trace but NO logs — projB must yield no session.
    const files: UploadedFile[] = [
      { name: 'logs.json', content: OTEL_A_LOGS, path: 'projA/logs.json' },
      { name: 'trace.json', content: OTEL_A_TRACE, path: 'projA/trace.json' },
      { name: 'trace.json', content: OTEL_B_TRACE, path: 'projB/trace.json' },
    ];

    const results = buildVizResults(files);

    expect(results).toHaveLength(1);
    const result = results[0];
    const agentView = result?.data.kind === 'agent' ? result.data.data : null;
    // Only projA session — projB trace has no paired logs so it is skipped.
    expect(agentView?.sessions).toHaveLength(1);
  });

  it('native .jsonl sessions (no user.id) appear under the synthetic agent', () => {
    const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];

    const results = buildVizResults(files);

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result?.title).toBe('agent');
    expect(result?.data.kind).toBe('agent');

    const agentView = result?.data.kind === 'agent' ? result.data.data : null;
    // The synthesized agent root node id must match the shared synthetic constant.
    expect(agentView?.root.id).toBe(SYNTHETIC_AGENT_ID);
  });

  it('loose files with no path field still produce a result', () => {
    const files: UploadedFile[] = [
      { name: 'logs.json', content: OTEL_A_LOGS },
      { name: 'trace.json', content: OTEL_A_TRACE },
    ];

    const results = buildVizResults(files);

    expect(results).toHaveLength(1);
    expect(['agent', 'session', 'interaction']).toContain(results[0]?.data.kind);
  });

  it('returns empty array when no usable files are provided', () => {
    expect(buildVizResults([])).toEqual([]);
    // A logs.json without any trace file produces nothing.
    expect(buildVizResults([{ name: 'logs.json', content: OTEL_A_LOGS }])).toEqual([]);
  });
});
