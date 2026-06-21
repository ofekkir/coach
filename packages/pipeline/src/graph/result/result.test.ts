import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../../orchestrate.ts';
import type { CanonicalNode, ToolNode, UploadedFile } from '../../types.ts';
import type { ExecutionGraph } from '../types.ts';
import { classifyErrorKind, matchToolResults } from './result.ts';

const FIXTURES = join(import.meta.dirname, '../../../fixtures');

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURES, relPath), 'utf8');
}

// ── error_kind classifier ──────────────────────────────────────────────────────

describe('classifyErrorKind', () => {
  const cases: readonly (readonly [string, ReturnType<typeof classifyErrorKind>])[] = [
    ['ENOENT: no such file or directory, open /tmp/x', 'not_found'],
    ['zsh: command not found: frobnicate', 'not_found'],
    ['Error: String to replace not found in file', 'invalid_args'],
    ['No match found for the provided old_string', 'invalid_args'],
    ['old_string is not unique in the file', 'invalid_args'],
    ['Invalid arguments: limit must be a number', 'invalid_args'],
    ['EACCES: permission denied, open /etc/passwd', 'permission'],
    ['Command timed out after 120s', 'timeout'],
    ['Exit code 2\nsome build output', 'nonzero_exit'],
    ['the process was killed', 'nonzero_exit'],
    ['something weird happened', 'other'],
  ];
  it.each(cases)('classifies %j as %s', (text, expected) => {
    expect(classifyErrorKind(text)).toBe(expected);
  });

  it('prefers invalid_args over not_found for a failed Edit match', () => {
    expect(classifyErrorKind('String to replace not found in file')).toBe('invalid_args');
  });
});

// ── matchToolResults on a hand-built graph ──────────────────────────────────────

function toolNode(id: string, name: string, toolUseId: string): ToolNode {
  return {
    id,
    type: 'tool',
    sessionId: 'session-s',
    interactionId: 'i',
    name,
    tool_use_id: toolUseId,
    tool_input: '{}',
    start_time_ns: '0',
    end_time_ns: '1',
    duration_ms: 1,
  };
}

function inference(id: string): CanonicalNode {
  return {
    id,
    type: 'llm_request',
    sessionId: 'session-s',
    interactionId: 'i',
    model: 'm',
    tokens_in: 1,
    tokens_out: 1,
    start_time_ns: '0',
    end_time_ns: '1',
    duration_ms: 1,
  };
}

function graphWith(nodes: readonly CanonicalNode[], inferenceId: string): ExecutionGraph {
  const byId: Record<string, CanonicalNode> = {};
  for (const n of nodes) byId[n.id] = n;
  return {
    kind: 'interaction',
    data: null,
    nodes: byId,
    deltas: {
      [inferenceId]: {
        requestMessagesDelta: [
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tu_ok', is_error: false, content: 'all good' },
              {
                type: 'tool_result',
                tool_use_id: 'tu_fail',
                is_error: true,
                content: 'Error: String to replace not found in file',
              },
            ],
          },
        ],
      },
    },
    semantics: {},
    actions: {},
    intents: {},
  };
}

describe('matchToolResults', () => {
  it('annotates a success and a failure, and classifies the failure', () => {
    const ok = toolNode('n-ok', 'Read', 'tu_ok');
    const fail = toolNode('n-fail', 'Edit', 'tu_fail');
    const inf = inference('inf');
    const { graph, unmatchedToolIds } = matchToolResults(graphWith([ok, fail, inf], 'inf'));

    const okOut = graph.nodes['n-ok'] as ToolNode;
    const failOut = graph.nodes['n-fail'] as ToolNode;

    expect(okOut.is_error).toBe(false);
    expect(okOut.error_kind).toBeUndefined();
    expect(okOut.result_summary).toBe('all good');

    expect(failOut.is_error).toBe(true);
    expect(failOut.error_kind).toBe('invalid_args');
    expect(failOut.result_summary).toContain('String to replace not found');

    expect(unmatchedToolIds).toEqual([]);
  });

  it('reports a tool call with no matching result instead of dropping it', () => {
    const orphan = toolNode('n-orphan', 'Bash', 'tu_missing');
    const inf = inference('inf');
    const { graph, unmatchedToolIds } = matchToolResults(graphWith([orphan, inf], 'inf'));
    const out = graph.nodes['n-orphan'] as ToolNode;
    expect(out.is_error).toBeUndefined();
    expect(unmatchedToolIds).toEqual(['n-orphan']);
  });

  it('truncates a long result_summary to ≤500 chars', () => {
    const long = 'x'.repeat(2000);
    const graph: ExecutionGraph = {
      kind: 'interaction',
      data: null,
      nodes: { 'n-1': toolNode('n-1', 'Bash', 'tu_long') },
      deltas: {
        inf: {
          requestMessagesDelta: [
            {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 'tu_long', content: long }],
            },
          ],
        },
      },
      semantics: {},
      actions: {},
      intents: {},
    };
    const out = matchToolResults(graph).graph.nodes['n-1'] as ToolNode;
    expect(out.result_summary?.length).toBeLessThanOrEqual(500);
  });
});

// ── Invariant: a real failing Edit + a succeeding tool through the full pipeline ──

describe('tool result/error invariant (failed Edit + success)', () => {
  const content = readFixture('native-claude/failed-edit/session.jsonl');
  const files: UploadedFile[] = [{ name: 'session.jsonl', content }];
  const { enrichedGraph, analysis } = runPipeline(files);
  const tools = Object.values(enrichedGraph.nodes).filter((n): n is ToolNode => n.type === 'tool');

  it('asserts is_error + error_kind + result_summary for the failing Edit', () => {
    const edit = tools.find((t) => t.name === 'Edit');
    expect(edit).toBeDefined();
    expect(edit?.is_error).toBe(true);
    expect(edit?.error_kind).toBe('invalid_args');
    expect(edit?.result_summary).toBeTruthy();
    expect(edit?.result_summary?.length).toBeGreaterThan(0);
  });

  it('asserts is_error=false / NULL error_kind for the succeeding tool', () => {
    const read = tools.find((t) => t.name === 'Read');
    expect(read).toBeDefined();
    expect(read?.is_error).toBe(false);
    expect(read?.error_kind).toBeUndefined();
  });

  it('rebases the misleading-file signal on failed edits per file', () => {
    const files = analysis.sessions.flatMap((s) => s.misleadingFiles);
    expect(files).toContainEqual(
      expect.objectContaining({ path: '/repo/foo.ts', failedEditCount: 1 }),
    );
  });
});
