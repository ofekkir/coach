import { describe, expect, it } from 'vitest';
import type { TraceNode } from '../etl/types.ts';
import { traceToMermaid } from './mermaid.ts';

const interaction: TraceNode = {
  id: 's0001',
  type: 'interaction',
  duration_ms: 21000,
  prompt: 'hello world',
};

const llmRequest: TraceNode = {
  id: 's0002',
  type: 'llm_request',
  parent: 's0001',
  duration_ms: 964,
  model: 'claude-sonnet-4-6',
  source: 'repl_main_thread',
  prompt: 'Do the thing',
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.001234,
};

const tool: TraceNode = {
  id: 's0003',
  type: 'tool',
  parent: 's0001',
  duration_ms: 5,
  name: 'Read',
  tool_input: '/path/to/file.ts',
};

const blockedOnUser: TraceNode = {
  id: 's0004',
  type: 'tool.blocked_on_user',
  parent: 's0003',
  duration_ms: 2,
};

const execution: TraceNode = {
  id: 's0005',
  type: 'tool.execution',
  parent: 's0003',
  duration_ms: 3,
};

const hook: TraceNode = {
  id: 'h0',
  type: 'hook',
  parent: 's0001',
  name: 'UserPromptSubmit',
};

describe('traceToMermaid', () => {
  it('starts with graph TD', () => {
    expect(traceToMermaid([interaction])).toMatch(/^graph TD/);
  });

  it('emits a node for each TraceNode', () => {
    const result = traceToMermaid([interaction, llmRequest]);
    expect(result).toContain('s0001');
    expect(result).toContain('s0002');
  });

  it('renders interaction label with prompt and duration', () => {
    const result = traceToMermaid([interaction]);
    expect(result).toContain('interaction');
    expect(result).toContain('hello world');
    expect(result).toContain('21000ms');
  });

  it('renders llm_request label with model, source, tokens, cost', () => {
    const result = traceToMermaid([llmRequest]);
    expect(result).toContain('llm_request');
    expect(result).toContain('model: claude-sonnet-4-6');
    expect(result).toContain('source: repl_main_thread');
    expect(result).toContain('tokens in: 100');
    expect(result).toContain('tokens out: 50');
    expect(result).toContain('cost: $0.001234');
  });

  it('renders tool label with name and input', () => {
    const result = traceToMermaid([tool]);
    expect(result).toContain('tool');
    expect(result).toContain('name: Read');
    expect(result).toContain('input: /path/to/file.ts');
  });

  it('renders tool.blocked_on_user as blocked_on_user', () => {
    const result = traceToMermaid([blockedOnUser]);
    expect(result).toContain('blocked_on_user');
    expect(result).not.toContain('tool.blocked_on_user');
  });

  it('renders tool.execution as execution', () => {
    const result = traceToMermaid([execution]);
    expect(result).toContain('execution');
    expect(result).not.toContain('tool.execution');
  });

  it('renders hook with hook label and name', () => {
    const result = traceToMermaid([hook]);
    expect(result).toContain('hook');
    expect(result).toContain('name: UserPromptSubmit');
  });

  it('emits edges from parent to child', () => {
    const result = traceToMermaid([interaction, llmRequest, tool]);
    expect(result).toContain('s0001 --> s0002');
    expect(result).toContain('s0001 --> s0003');
  });

  it('does not emit edge for root node with no parent', () => {
    const result = traceToMermaid([interaction, llmRequest]);
    const edges = result.split('\n').filter((l) => l.includes('-->'));
    expect(edges.every((e) => !e.includes('--> s0001'))).toBe(true);
  });

  it('escapes backticks and double-quotes in label content', () => {
    const node: TraceNode = {
      id: 'sx',
      type: 'interaction',
      prompt: 'use `backticks` and "quotes"',
    };
    const result = traceToMermaid([node]);
    expect(result).not.toContain('`backticks`');
    expect(result).not.toContain('"quotes"');
  });

  it('renders all node types without throwing', () => {
    expect(() =>
      traceToMermaid([interaction, llmRequest, tool, blockedOnUser, execution, hook]),
    ).not.toThrow();
  });
});
