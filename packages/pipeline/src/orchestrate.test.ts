import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVizResults, runPipeline } from './orchestrate.ts';
import { PSEUDO_USER_ID } from './types.ts';
import type { UploadedFile } from './types.ts';

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
  it('two distinct OTEL sessions roll up under one agent', () => {
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

    const agentView = result?.data.kind === 'agent' ? result.data.data : null;
    expect(agentView?.sessions).toHaveLength(2);
  });

  it('routes by session id, not directory — paths are irrelevant to grouping', () => {
    // Same two sessions as above, but with logs/traces flattened into one directory.
    // Session-id routing keeps them apart where the old directory bucketing could not.
    const files: UploadedFile[] = [
      { name: 'logs.json', content: OTEL_A_LOGS },
      { name: 'trace.json', content: OTEL_A_TRACE },
      { name: 'trace-b.json', content: OTEL_B_TRACE },
    ];

    const { sessions } = runPipeline(files);
    expect(sessions).toHaveLength(2);
  });

  it('native .jsonl session uses pseudo_user_id when no real user identity exists', () => {
    const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];

    const results = buildVizResults(files);

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe(PSEUDO_USER_ID);
    expect(results[0]?.data.kind).toBe('agent');

    const agentView = results[0]?.data.kind === 'agent' ? results[0].data.data : null;
    expect(agentView?.root.id).toBe(`agent-${PSEUDO_USER_ID}`);
  });

  it('marks unrecognised files unsupported without dropping the usable ones', () => {
    const { classified, sessions } = runPipeline([
      { name: 'README.md', content: 'noise' },
      { name: 'session.jsonl', content: NATIVE_JSONL },
    ]);

    expect(classified.find((c) => c.file.name === 'README.md')?.type).toBe('unsupported');
    expect(sessions).toHaveLength(1);
  });

  it('returns empty array when nothing renderable is produced', () => {
    expect(buildVizResults([])).toEqual([]);
    // logs.json resolves a session id but has no trace, so it yields no nodes.
    expect(buildVizResults([{ name: 'logs.json', content: OTEL_A_LOGS }])).toEqual([]);
  });
});
