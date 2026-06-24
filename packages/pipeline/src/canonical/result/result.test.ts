import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runPipeline } from '../../orchestrate.ts';
import type { CanonicalNode, RequestMessage, ToolNode, UploadedFile } from '../../types.ts';

import { attachToolResults, classifyErrorKind } from './result.ts';

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

// ── attachToolResults on a hand-built node list ──────────────────────────────────

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

// The consuming inference carries each tool's result as a tool_result block in its
// request_messages — the canonical field this pass reads (harness-agnostic).
function inference(id: string, requestMessages: RequestMessage[]): CanonicalNode {
  return {
    id,
    type: 'llm_request',
    sessionId: 'session-s',
    interactionId: 'i',
    model: 'm',
    tokens_in: 1,
    tokens_out: 1,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    request_messages: requestMessages,
    start_time_ns: '0',
    end_time_ns: '1',
    duration_ms: 1,
  };
}

function toolResultMessage(blocks: readonly unknown[]): RequestMessage {
  return { role: 'user', content: blocks };
}

function byId(nodes: readonly CanonicalNode[], id: string): ToolNode {
  return nodes.find((n) => n.id === id) as ToolNode;
}

describe('attachToolResults', () => {
  it('annotates a success and a failure, classifies the failure, and sizes the output', () => {
    const ok = toolNode('n-ok', 'Read', 'tu_ok');
    const fail = toolNode('n-fail', 'Edit', 'tu_fail');
    const inf = inference('inf', [
      toolResultMessage([
        { type: 'tool_result', tool_use_id: 'tu_ok', is_error: false, content: 'all good' },
        {
          type: 'tool_result',
          tool_use_id: 'tu_fail',
          is_error: true,
          content: 'Error: String to replace not found in file',
        },
      ]),
    ]);
    const out = attachToolResults([ok, fail, inf]);

    const okOut = byId(out, 'n-ok');
    expect(okOut.is_error).toBe(false);
    expect(okOut.error_kind).toBeUndefined();
    expect(okOut.output_size).toBe('all good'.length);
    expect(okOut.error_message).toBeUndefined(); // success content is not stored

    const failOut = byId(out, 'n-fail');
    expect(failOut.is_error).toBe(true);
    expect(failOut.error_kind).toBe('invalid_args');
    expect(failOut.error_message).toContain('String to replace not found');
    expect(failOut.output_size).toBeGreaterThan(0);
  });

  it('leaves a tool call with no matching result untouched (is_error NULL)', () => {
    const orphan = toolNode('n-orphan', 'Bash', 'tu_missing');
    const inf = inference('inf', []);
    const out = byId(attachToolResults([orphan, inf]), 'n-orphan');
    expect(out.is_error).toBeUndefined();
    expect(out.output_size).toBeUndefined();
  });

  it('truncates a long error_message to ≤500 chars', () => {
    const long = 'x'.repeat(2000);
    const tool = toolNode('n-1', 'Bash', 'tu_long');
    const inf = inference('inf', [
      toolResultMessage([
        { type: 'tool_result', tool_use_id: 'tu_long', is_error: true, content: long },
      ]),
    ]);
    const out = byId(attachToolResults([tool, inf]), 'n-1');
    expect(out.error_message?.length).toBeLessThanOrEqual(500);
    expect(out.output_size).toBe(long.length); // size reflects the full content
  });
});

// ── Invariant: a real failing Edit + a succeeding tool through the full pipeline ──

describe('tool result/error invariant (failed Edit + success)', () => {
  const content = readFixture('native-claude/failed-edit/session.jsonl');
  const files: UploadedFile[] = [{ name: 'session.jsonl', content }];
  const { enrichedGraph } = runPipeline(files);
  const tools = Object.values(enrichedGraph.nodes).filter((n): n is ToolNode => n.type === 'tool');

  it('asserts is_error + error_kind + error_message for the failing Edit', () => {
    const edit = tools.find((t) => t.name === 'Edit');
    expect(edit).toBeDefined();
    expect(edit?.is_error).toBe(true);
    expect(edit?.error_kind).toBe('invalid_args');
    expect(edit?.error_message).toBeTruthy();
    expect(edit?.error_message?.length).toBeGreaterThan(0);
  });

  it('asserts is_error=false / NULL error_kind for the succeeding tool', () => {
    const read = tools.find((t) => t.name === 'Read');
    expect(read).toBeDefined();
    expect(read?.is_error).toBe(false);
    expect(read?.error_kind).toBeUndefined();
  });

  it('exposes the failed edit + its file path — the data the misleading-file query groups on', () => {
    // The "misleading file" signal is now a query (failed Edit/Write GROUP BY
    // file_path), not a pipeline finding; this asserts the data it keys on exists.
    const failedEdit = tools.find((t) => t.is_error === true && t.name === 'Edit');
    expect(failedEdit).toBeDefined();
    expect(failedEdit?.tool_input).toContain('/repo/foo.ts');
  });
});
