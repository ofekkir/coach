import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildVizResultFromExecutionGraph, runPipeline } from './orchestrate.ts';
import { PSEUDO_USER_ID } from './types.ts';
import type { ToolNode, UploadedFile } from './types.ts';

const FIXTURES = join(import.meta.dirname, '../fixtures');

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURES, relPath), 'utf8');
}

const OTEL_A_LOGS = readFixture('otel/fetch-website/logs.json');
const OTEL_A_TRACE = readFixture('otel/fetch-website/trace.json');
const OTEL_B_LOGS = readFixture('otel/update-claude-config/logs.json');
const OTEL_B_TRACE = readFixture('otel/update-claude-config/trace.json');
const NATIVE_JSONL = readFixture('native-claude/fetch-website/session.jsonl');

describe('runPipeline', () => {
  it('two distinct OTEL sessions roll up under one agent', () => {
    const files: UploadedFile[] = [
      { name: 'logs.json', content: OTEL_A_LOGS, path: 'projA/logs.json' },
      { name: 'trace.json', content: OTEL_A_TRACE, path: 'projA/trace.json' },
      { name: 'logs.json', content: OTEL_B_LOGS, path: 'projB/logs.json' },
      { name: 'trace.json', content: OTEL_B_TRACE, path: 'projB/trace.json' },
    ];

    const { enrichedGraph } = runPipeline(files);

    expect(enrichedGraph.kind).toBe('agent');
    const agentView = enrichedGraph.kind === 'agent' ? enrichedGraph.data : null;
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

    const { enrichedGraph } = runPipeline(files);

    expect(enrichedGraph.kind).toBe('agent');
    const agentView = enrichedGraph.kind === 'agent' ? enrichedGraph.data : null;
    expect(agentView?.agent.userId).toBe(PSEUDO_USER_ID);
    expect(agentView?.agent.id).toBe(`agent-${PSEUDO_USER_ID}`);
  });

  it('marks unrecognised files unsupported without dropping the usable ones', () => {
    const { classified, sessions } = runPipeline([
      { name: 'README.md', content: 'noise' },
      { name: 'session.jsonl', content: NATIVE_JSONL },
    ]);

    expect(classified.find((c) => c.file.name === 'README.md')?.type).toBe('unsupported');
    expect(sessions).toHaveLength(1);
  });

  it('carries failed-tool error fields onto the app-facing view-model nodes', () => {
    // The app renders VizResult.data.nodes — assert a failed Edit reaches that
    // shape with is_error/error_kind/error_message intact, so the card builder can
    // mark the failure.
    const files: UploadedFile[] = [
      { name: 'session.jsonl', content: readFixture('native-claude/failed-edit/session.jsonl') },
    ];
    const { enrichedGraph } = runPipeline(files);
    const viz = buildVizResultFromExecutionGraph(enrichedGraph, 'failed-edit');
    const failedEdit = Object.values(viz.data.nodes).find(
      (n): n is ToolNode => n.type === 'tool' && n.is_error === true && n.name === 'Edit',
    );
    expect(failedEdit).toBeDefined();
    expect(failedEdit?.error_kind).toBe('invalid_args');
    expect(failedEdit?.error_message).toBeTruthy();
  });

  it('produces no sessions when nothing renderable is present', () => {
    expect(runPipeline([]).agentGraph.sessions).toHaveLength(0);
    // logs.json resolves a session id but has no trace, so it yields no nodes.
    expect(
      runPipeline([{ name: 'logs.json', content: OTEL_A_LOGS }]).agentGraph.sessions,
    ).toHaveLength(0);
  });
});
