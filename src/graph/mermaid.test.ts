import { describe, expect, it } from 'vitest';
import type { TraceNode } from '../etl/types.ts';
import { traceToCausalMermaid, traceToMermaid } from './mermaid.ts';

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

describe('traceToCausalMermaid', () => {
  const llm1: TraceNode = {
    id: 'llm1',
    type: 'llm_request',
    parent: 's0001',
    source: 'repl_main_thread',
    start_time_ns: '100000000',
    end_time_ns: '200000000',
  };
  const toolA: TraceNode = {
    id: 'toolA',
    type: 'tool',
    parent: 's0001',
    name: 'Read',
    start_time_ns: '210000000',
    end_time_ns: '300000000',
  };
  const llm2: TraceNode = {
    id: 'llm2',
    type: 'llm_request',
    parent: 's0001',
    source: 'repl_main_thread',
    start_time_ns: '310000000',
    end_time_ns: '400000000',
  };
  const bgLlm: TraceNode = {
    id: 'bgLlm',
    type: 'llm_request',
    parent: 's0001',
    source: 'background',
    start_time_ns: '150000000',
    end_time_ns: '500000000',
  };

  it('starts with graph TD', () => {
    expect(traceToCausalMermaid([interaction])).toMatch(/^graph TD/);
  });

  it('returns early with no interaction node', () => {
    expect(traceToCausalMermaid([llmRequest])).toContain('%% no interaction node');
  });

  it('emits interaction as root node', () => {
    const result = traceToCausalMermaid([interaction, llm1]);
    expect(result).toContain('s0001');
    expect(result).toContain('interaction');
  });

  it('groups llm_requests by source into thread subgraphs', () => {
    const result = traceToCausalMermaid([interaction, llm1, llm2]);
    expect(result).toContain('subgraph thread_repl_main_thread');
    expect(result).toContain('llm1');
    expect(result).toContain('llm2');
  });

  it('connects sequential llm_requests within a thread', () => {
    const result = traceToCausalMermaid([interaction, llm1, llm2]);
    expect(result).toMatch(/llm1.*-->.*llm2/);
  });

  it('assigns tool to the thread whose llm_request ended most recently before it', () => {
    const result = traceToCausalMermaid([interaction, llm1, toolA, llm2, bgLlm]);
    expect(result).toContain('toolA');
    // toolA starts at 210ms, llm1 ends at 200ms — assigned to repl_main_thread
    expect(result).toMatch(/subgraph thread_repl_main_thread[\s\S]*toolA[\s\S]*end/);
  });

  it('wraps tool nodes with children in a subgraph', () => {
    const toolWithChild: TraceNode = {
      id: 'twc',
      type: 'tool',
      parent: 's0001',
      name: 'Skill',
      start_time_ns: '210000000',
      end_time_ns: '300000000',
    };
    const child: TraceNode = {
      id: 'child1',
      type: 'tool.execution',
      parent: 'twc',
      start_time_ns: '215000000',
    };
    const result = traceToCausalMermaid([interaction, llm1, toolWithChild, child]);
    expect(result).toContain('subgraph sg_twc');
    expect(result).toContain('child1');
  });

  it('emits separate subgraphs for distinct thread sources', () => {
    const result = traceToCausalMermaid([interaction, llm1, bgLlm]);
    expect(result).toContain('thread_repl_main_thread');
    expect(result).toContain('thread_background');
  });
});
