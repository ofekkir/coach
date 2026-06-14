import { describe, expect, it } from 'vitest';
import type {
  ActionNode,
  AgentNode,
  InferenceNode,
  LlmRequestNode,
  ToolExecutionNode,
} from '@coach/pipeline';
import { buildNodeCard, formatGap, formatMetrics } from './format.ts';

const span = { start_time_ns: '0', end_time_ns: '1', duration_ms: 12 };
const tokens = { tokens_in: 40, tokens_out: 12 };

describe('buildNodeCard', () => {
  it('maps the structural discriminant to a display type and title', () => {
    const agent: AgentNode = { id: 'a', type: 'agent', user_id: 'u-1' };
    const card = buildNodeCard(agent);
    expect(card.type).toBe('agent');
    expect(card.title).toBe('u-1');
    expect(card.fields).toEqual([]);
  });

  it('collapses tool.execution to its display type with no title', () => {
    const exec: ToolExecutionNode = { id: 't', type: 'tool.execution', ...span };
    expect(buildNodeCard(exec).type).toBe('execution');
  });

  it('puts model on the title and source in a structural field', () => {
    const llm: LlmRequestNode = {
      id: 'l',
      type: 'llm_request',
      model: 'claude-opus-4-8',
      source: 'main',
      ...span,
      ...tokens,
    };
    const card = buildNodeCard(llm);
    expect(card.title).toBe('claude-opus-4-8');
    expect(card.fields).toEqual([{ label: 'source', value: 'main' }]);
  });

  it('carries metrics as raw numbers, not formatted strings', () => {
    const llm: LlmRequestNode = {
      id: 'l',
      type: 'llm_request',
      model: 'claude-opus-4-8',
      cost_usd: 0.0001,
      ...span,
      ...tokens,
    };
    expect(buildNodeCard(llm).metrics).toEqual({
      durationMs: 12,
      tokensIn: 40,
      tokensOut: 12,
      costUsd: 0.0001,
    });
  });

  it('does NOT read response_messages content (the card stays content-free)', () => {
    const inference: InferenceNode = {
      id: 'i',
      type: 'inference',
      what: ['decides to read the file'],
      model: 'claude-opus-4-8',
      response_messages: [{ type: 'text', text: 'should never appear on the card' }],
      ...span,
      ...tokens,
    };
    const card = buildNodeCard(inference);
    expect(card.title).toBe('decides to read the file');
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain('should never appear');
  });

  it('does NOT read tool_input content', () => {
    const action: ActionNode = {
      id: 'ac',
      type: 'action',
      what: ['edits config'],
      name: 'Edit',
      tool_input: '{"file":"/secret/path"}',
      ...span,
    };
    const card = buildNodeCard(action);
    expect(JSON.stringify(card)).not.toContain('/secret/path');
  });

  it('joins a multi-action `what` into a single title', () => {
    const action: ActionNode = {
      id: 'wf',
      type: 'action',
      what: ['fetch ynet.co.il', 'summarize headlines'],
      name: 'WebFetch',
      ...span,
    };
    expect(buildNodeCard(action).title).toBe('fetch ynet.co.il · summarize headlines');
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
