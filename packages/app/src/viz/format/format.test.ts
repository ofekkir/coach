import type {
  Agent,
  LlmRequestNode,
  ResolvedNode,
  Session,
  ToolExecutionNode,
  ToolNode,
} from '@coach/pipeline';
import { describe, expect, it } from 'vitest';

import {
  buildAgentCard,
  buildNodeCard,
  buildSessionCard,
  formatGap,
  formatMetrics,
} from './format.ts';

const SID = 'session-s-1';
const span = { start_time_ns: '0', end_time_ns: '1', duration_ms: 12 };
const tokens = { tokens_in: 40, tokens_out: 12, cache_read_tokens: 0, cache_write_tokens: 0 };

function resolved(node: ResolvedNode['node'], semantics?: ResolvedNode['semantics']): ResolvedNode {
  return { node, ...(semantics != null ? { semantics } : {}) };
}

// A semantics overlay from a list of static labels (one entry each).
function sem(...labels: string[]): ResolvedNode['semantics'] {
  return { entries: labels.map((label) => ({ static: label })) };
}

describe('buildNodeCard', () => {
  it('collapses tool.execution to its display type with no title', () => {
    const exec: ToolExecutionNode = { id: 't', type: 'tool.execution', sessionId: SID, ...span };
    expect(buildNodeCard(resolved(exec)).type).toBe('execution');
  });

  it('puts model on the title and source in a structural field (no semantics row)', () => {
    const llm: LlmRequestNode = {
      id: 'l',
      type: 'llm_request',
      sessionId: SID,
      model: 'claude-opus-4-8',
      source: 'main',
      ...span,
      ...tokens,
    };
    const card = buildNodeCard(resolved(llm));
    expect(card.title).toBe('claude-opus-4-8');
    expect(card.fields).toEqual([{ label: 'source', value: 'main' }]);
  });

  it('carries metrics as raw numbers, not formatted strings', () => {
    const llm: LlmRequestNode = {
      id: 'l',
      type: 'llm_request',
      sessionId: SID,
      model: 'claude-opus-4-8',
      cost_usd: 0.0001,
      ...span,
      ...tokens,
    };
    expect(buildNodeCard(resolved(llm)).metrics).toEqual({
      durationMs: 12,
      tokensIn: 40,
      tokensOut: 12,
      costUsd: 0.0001,
    });
  });

  it('reads the verb from the semantics overlay, never response content', () => {
    const llm: LlmRequestNode = {
      id: 'i',
      type: 'llm_request',
      sessionId: SID,
      model: 'claude-opus-4-8',
      response_messages: [{ type: 'text', text: 'should never appear on the card' }],
      ...span,
      ...tokens,
    };
    const card = buildNodeCard(resolved(llm, sem('decides to read the file')));
    expect(card.title).toBe('decides to read the file');
    expect(JSON.stringify(card)).not.toContain('should never appear');
  });

  it('does NOT read tool_input content', () => {
    const tool: ToolNode = {
      id: 'ac',
      type: 'tool',
      sessionId: SID,
      name: 'Edit',
      tool_input: '{"file":"/secret/path"}',
      ...span,
    };
    const card = buildNodeCard(resolved(tool, sem('edits config')));
    expect(JSON.stringify(card)).not.toContain('/secret/path');
  });

  it('leads with the verb and carries the sub-verb + tool tag (enriched tool)', () => {
    const tool: ToolNode = { id: 'wf', type: 'tool', sessionId: SID, name: 'WebFetch', ...span };
    const card = buildNodeCard(resolved(tool, sem('fetch example.com', 'summarize headlines')));
    expect(card.title).toBe('fetch example.com');
    expect(card.subtitle).toBe('summarize headlines');
    expect(card.tag).toBe('ACTION · WEBFETCH');
  });

  it('threads a failed tool call outcome onto card.error (kind + message)', () => {
    const tool: ToolNode = {
      id: 'ed',
      type: 'tool',
      sessionId: SID,
      name: 'Edit',
      is_error: true,
      error_kind: 'invalid_args',
      error_message: 'String to replace not found in file',
      ...span,
    };
    const card = buildNodeCard(resolved(tool, sem('edits config')));
    expect(card.error).toEqual({
      kind: 'invalid_args',
      message: 'String to replace not found in file',
    });
  });

  it('leaves card.error absent for a successful tool call', () => {
    const tool: ToolNode = {
      id: 'rd',
      type: 'tool',
      sessionId: SID,
      name: 'Read',
      is_error: false,
      ...span,
    };
    expect(buildNodeCard(resolved(tool, sem('reads file'))).error).toBeUndefined();
  });

  it('tags an inference by its off-spine source, leaving the main thread bare', () => {
    const base = {
      type: 'llm_request',
      sessionId: SID,
      model: 'claude-sonnet-4-6',
      ...span,
      ...tokens,
    } as const;
    const main: LlmRequestNode = { id: 'm', source: 'repl_main_thread', ...base };
    const bg: LlmRequestNode = { id: 'b', source: 'background', ...base };
    const what = sem('plan next steps');
    expect(buildNodeCard(resolved(main, what)).tag).toBe('INFERENCE');
    expect(buildNodeCard(resolved(bg, what)).tag).toBe('INFERENCE · BACKGROUND');
  });
});

describe('entity cards', () => {
  it('builds the agent card from the entity userId', () => {
    const agent: Agent = { id: 'agent-u-1', userId: 'u-1' };
    const card = buildAgentCard(agent);
    expect(card.type).toBe('agent');
    expect(card.title).toBe('u-1');
    expect(card.fields).toEqual([]);
  });

  it('builds the session card from the harness session id', () => {
    const session: Session = {
      id: SID,
      agentId: 'agent-u-1',
      userId: 'u-1',
      sessionId: 'abcdef',
    };
    const card = buildSessionCard(session);
    expect(card.type).toBe('session');
    expect(card.title).toBe('abcdef');
  });
});

describe('formatMetrics', () => {
  it('renders duration as a chip and collapses tokens/cost into one line', () => {
    expect(formatMetrics({ durationMs: 12, tokensIn: 40, tokensOut: 5, costUsd: 0.0001 })).toEqual({
      duration: '12ms',
      secondary: 'in 40 · out 5 · $0.000100',
    });
  });

  it('scales duration to seconds when >= 1000ms', () => {
    expect(formatMetrics({ durationMs: 1122 }).duration).toBe('1.1s');
    expect(formatMetrics({ durationMs: 1600 }).duration).toBe('1.6s');
    expect(formatMetrics({ durationMs: 90_000 }).duration).toBe('1.5min');
  });

  it('returns nulls when no metrics are present', () => {
    expect(formatMetrics({})).toEqual({ duration: null, secondary: null });
  });
});

describe('formatGap', () => {
  it('signs the gap and returns null for zero/absent', () => {
    expect(formatGap(12)).toBe('+12ms');
    expect(formatGap(-3)).toBe('-3ms');
    expect(formatGap(0)).toBeNull();
    expect(formatGap(undefined)).toBeNull();
  });

  it('scales to seconds and minutes', () => {
    expect(formatGap(1122)).toBe('+1.1s');
    expect(formatGap(1600)).toBe('+1.6s');
    expect(formatGap(60_000)).toBe('+1.0min');
    expect(formatGap(90_000)).toBe('+1.5min');
  });
});
