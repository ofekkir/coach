import { describe, expect, it } from 'vitest';
import type { CanonicalNode, RequestMessage, ResponseMessage } from '../../types.ts';
import type { AgentExecution, ExecutionGraph, ExecutionNode, Thread } from '../types.ts';
import { buildExecutionGraph, buildInteractionExecution } from './execution.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────

// Span-derived nodes carry real OTLP timing; this keeps fixtures self-consistent
// (ns = ms × 1e6) without spelling out all three fields each time.
function span(
  startMs: number,
  endMs: number,
): {
  start_time_ns: string;
  end_time_ns: string;
  duration_ms: number;
} {
  return {
    start_time_ns: String(startMs * 1_000_000),
    end_time_ns: String(endMs * 1_000_000),
    duration_ms: endMs - startMs,
  };
}

const interaction: CanonicalNode = {
  id: 'root',
  type: 'interaction',
  session_id: 's-1',
  user_id: 'u-1',
  sequence: 0,
  prompt: 'hello',
  ...span(90, 500),
};

const llm1: CanonicalNode = {
  id: 'llm1',
  type: 'llm_request',
  parent: 'root',
  source: 'repl_main_thread',
  model: '',
  tokens_in: 0,
  tokens_out: 0,
  ...span(100, 200),
};

const llm2: CanonicalNode = {
  id: 'llm2',
  type: 'llm_request',
  parent: 'root',
  source: 'repl_main_thread',
  model: '',
  tokens_in: 0,
  tokens_out: 0,
  ...span(310, 400),
};

const toolAfterLlm1: CanonicalNode = {
  id: 'toolA',
  type: 'tool',
  parent: 'root',
  name: 'Read',
  ...span(210, 300),
};

// A small full agent forest: agent ▸ session ▸ interaction ▸ (llm1, toolA, llm2).
function agentForest(): CanonicalNode[] {
  const agent: CanonicalNode = { id: 'agent', type: 'agent', user_id: 'u1' };
  const session: CanonicalNode = {
    id: 'sess',
    type: 'session',
    parent: 'agent',
    session_id: 's-123',
    user_id: 'u1',
  };
  const inter: CanonicalNode = { ...interaction, parent: 'sess' };
  return [agent, session, inter, llm1, toolAfterLlm1, llm2];
}

// ── Recursive lossless / cleanliness assertions ────────────────────────────────

function assertClean(node: ExecutionNode): void {
  expect(node.canonical).toBeDefined();
  expect(node.id).toBe(node.canonical.id);
  expect(node).not.toHaveProperty('labelLines');
  expect(node).not.toHaveProperty('segments');
  expect(node).not.toHaveProperty('segmentIndex');
  expect(node).not.toHaveProperty('shape');
  expect(node).not.toHaveProperty('moves');
  expect(node).not.toHaveProperty('verb');
  expect(node).not.toHaveProperty('kind');
  for (const child of node.children) assertClean(child);
}

function soleAgent(graph: ExecutionGraph): AgentExecution {
  if (graph.kind !== 'agent') throw new Error('expected agent graph');
  return graph.data;
}

function soleThread(agent: AgentExecution): Thread {
  const thread = agent.sessions[0]?.interactions[0]?.threads[0];
  if (thread == null) throw new Error('expected a thread');
  return thread;
}

function everyNode(agent: AgentExecution): ExecutionNode[] {
  const sessionNodes = agent.sessions.flatMap((s) => [
    s.root,
    ...s.interactions.flatMap((i) => [i.root, ...i.threads.flatMap((t) => t.members)]),
  ]);
  return [agent.root, ...sessionNodes];
}

describe('buildExecutionGraph', () => {
  it('builds kind:agent with sessions ▸ interactions ▸ threads ▸ members', () => {
    const agent = soleAgent(buildExecutionGraph(agentForest()));
    expect(agent.root.id).toBe('agent');
    expect(agent.sessions).toHaveLength(1);

    const session = agent.sessions[0];
    expect(session?.root.id).toBe('sess');
    expect(session?.interactions).toHaveLength(1);

    const inter = session?.interactions[0];
    expect(inter?.root.id).toBe('root');
    expect(inter?.threads).toHaveLength(1);
    expect(inter?.rootToThreadIds).toEqual(['thread_repl_main_thread']);

    const thread = soleThread(agent);
    expect(thread.id).toBe('thread_repl_main_thread');
    expect(thread.source).toBe('repl_main_thread');
    // sorted by start: llm1(100ms), toolA(210ms), llm2(310ms)
    expect(thread.members.map((m) => m.id)).toEqual(['llm1', 'toolA', 'llm2']);
  });

  it('synthesizes a user_prompt node as the head of the interaction', () => {
    const agent = soleAgent(buildExecutionGraph(agentForest()));
    const inter = agent.sessions[0]?.interactions[0];
    expect(inter?.userPrompt?.canonical.type).toBe('user_prompt');
    expect(inter?.userPrompt?.canonical).toMatchObject({ prompt: 'hello' });
  });

  it('embeds the full CanonicalNode losslessly on every node', () => {
    const agent = soleAgent(buildExecutionGraph(agentForest()));

    const llm1Node = soleThread(agent).members.find((m) => m.id === 'llm1');
    expect(llm1Node?.canonical).toBe(llm1);
    expect(llm1Node?.canonical).toMatchObject({ source: 'repl_main_thread' });

    everyNode(agent).forEach(assertClean);
  });

  it('carries the signed gap on causal edges (not on member ordering)', () => {
    const graph = buildExecutionGraph(agentForest());
    if (graph.kind !== 'agent') throw new Error('expected agent');

    const causal = graph.data.sessions[0]?.interactions[0]?.causalEdges ?? [];
    // llm1 ends at 200ms, toolA starts at 210ms → +10ms on the causal edge.
    const edge = causal.find((e) => e.fromId === 'llm1' && e.toId === 'toolA');
    expect(edge?.gapMs).toBe(10);
  });

  it('uses plain canonical ids on causal edges (no sg_ prefix)', () => {
    const toolWithChild: CanonicalNode = {
      id: 'twc',
      type: 'tool',
      parent: 'root',
      name: 'Skill',
      ...span(210, 300),
    };
    const child: CanonicalNode = {
      id: 'child1',
      type: 'tool.execution',
      parent: 'twc',
      ...span(215, 220),
    };
    const inter = buildInteractionExecution([interaction, llm1, toolWithChild, child]);
    const edges = inter?.causalEdges ?? [];
    expect(edges.some((e) => e.toId === 'twc')).toBe(true);
    expect(edges.some((e) => e.fromId.startsWith('sg_') || e.toId.startsWith('sg_'))).toBe(false);
  });

  it('preserves nested children on container nodes', () => {
    const toolWithChild: CanonicalNode = {
      id: 'twc',
      type: 'tool',
      parent: 'root',
      name: 'Skill',
      ...span(210, 300),
    };
    const child: CanonicalNode = {
      id: 'child1',
      type: 'tool.execution',
      parent: 'twc',
      ...span(215, 220),
    };
    const inter = buildInteractionExecution([interaction, llm1, toolWithChild, child]);
    const member = inter?.threads[0]?.members.find((m) => m.id === 'twc');
    expect(member?.children).toHaveLength(1);
    expect(member?.children[0]?.id).toBe('child1');
    expect(member?.children[0]?.canonical).toBe(child);
  });

  it('degrades to kind:session when no agent node is present', () => {
    const session: CanonicalNode = {
      id: 'sess',
      type: 'session',
      session_id: 's-1',
      user_id: 'u-1',
    };
    const inter: CanonicalNode = { ...interaction, parent: 'sess' };
    const graph = buildExecutionGraph([session, inter, { ...llm1, parent: 'root' }]);
    expect(graph.kind).toBe('session');
  });

  it('degrades to kind:interaction when only an interaction is present', () => {
    const graph = buildExecutionGraph([interaction, llm1]);
    expect(graph.kind).toBe('interaction');
    if (graph.kind !== 'interaction') return;
    expect(graph.data?.root.id).toBe('root');
  });

  it('returns kind:interaction with null data when no interaction exists', () => {
    const graph = buildExecutionGraph([llm1]);
    expect(graph).toEqual({ kind: 'interaction', data: null });
  });
});

// ── Message delta tests ──────────────────────────────────────────────────────

const msg1: RequestMessage = { role: 'user', content: 'Hello' };
const msg2: RequestMessage = { role: 'assistant', content: 'Hi there' };
const msg3: RequestMessage = { role: 'user', content: 'Do the thing' };

const resMsgs1: ResponseMessage[] = [{ type: 'text', text: 'Hi there' }];
const resMsgs2: ResponseMessage[] = [{ type: 'tool_use', name: 'Read', id: 'tu1' }];

function makeInteractionWithLlms(llmNodes: CanonicalNode[]): CanonicalNode[] {
  return [
    {
      id: 'root',
      type: 'interaction',
      session_id: 's-1',
      user_id: 'u-1',
      sequence: 0,
      prompt: 'test',
      ...span(90, 500),
    },
    ...llmNodes,
  ];
}

function findMember(
  inter: ReturnType<typeof buildInteractionExecution>,
  id: string,
): ExecutionNode {
  const member = inter?.threads[0]?.members.find((m) => m.id === id);
  if (member == null) throw new Error(`member ${id} not found`);
  return member;
}

describe('message deltas on thread members', () => {
  it('first llm_request in thread gets its full request_messages as delta', () => {
    const llm: CanonicalNode = {
      id: 'llm1',
      type: 'llm_request',
      parent: 'root',
      source: 'repl_main_thread',
      model: '',
      tokens_in: 0,
      tokens_out: 0,
      ...span(100, 200),
      request_messages: [msg1],
      response_messages: resMsgs1,
    };
    const inter = buildInteractionExecution(makeInteractionWithLlms([llm]));
    const member = findMember(inter, 'llm1');
    expect(member.requestMessagesDelta).toEqual([msg1]);
    expect(member.responseMessagesDelta).toEqual(resMsgs1);
  });

  it('subsequent llm_request gets suffix beyond previous request length as delta', () => {
    const llmA: CanonicalNode = {
      id: 'llmA',
      type: 'llm_request',
      parent: 'root',
      source: 'repl_main_thread',
      model: '',
      tokens_in: 0,
      tokens_out: 0,
      ...span(100, 200),
      request_messages: [msg1, msg2],
      response_messages: resMsgs1,
    };
    const llmB: CanonicalNode = {
      id: 'llmB',
      type: 'llm_request',
      parent: 'root',
      source: 'repl_main_thread',
      model: '',
      tokens_in: 0,
      tokens_out: 0,
      ...span(300, 400),
      request_messages: [msg1, msg2, msg3],
      response_messages: resMsgs2,
    };
    const inter = buildInteractionExecution(makeInteractionWithLlms([llmA, llmB]));
    const memberA = findMember(inter, 'llmA');
    const memberB = findMember(inter, 'llmB');

    expect(memberA.requestMessagesDelta).toEqual([msg1, msg2]);
    expect(memberB.requestMessagesDelta).toEqual([msg3]);
    expect(memberB.responseMessagesDelta).toEqual(resMsgs2);
  });

  it('single-request thread: delta equals full request_messages', () => {
    const llm: CanonicalNode = {
      id: 'llmOnly',
      type: 'llm_request',
      parent: 'root',
      source: 'repl_main_thread',
      model: '',
      tokens_in: 0,
      tokens_out: 0,
      ...span(100, 200),
      request_messages: [msg1, msg2, msg3],
      response_messages: resMsgs1,
    };
    const inter = buildInteractionExecution(makeInteractionWithLlms([llm]));
    const member = findMember(inter, 'llmOnly');
    expect(member.requestMessagesDelta).toEqual([msg1, msg2, msg3]);
  });

  it('native format: each llm_request carries only new messages as delta', () => {
    // Native traces log only the delta per request, not the full cumulative history.
    const llmA: CanonicalNode = {
      id: 'llmA',
      type: 'llm_request',
      parent: 'root',
      source: 'repl_main_thread',
      model: '',
      tokens_in: 0,
      tokens_out: 0,
      ...span(100, 200),
      request_messages: [msg1, msg2],
      response_messages: resMsgs1,
    };
    const llmB: CanonicalNode = {
      id: 'llmB',
      type: 'llm_request',
      parent: 'root',
      source: 'repl_main_thread',
      model: '',
      tokens_in: 0,
      tokens_out: 0,
      ...span(300, 400),
      // Native: only the new message, not the full history
      request_messages: [msg3],
      response_messages: resMsgs2,
    };
    const inter = buildInteractionExecution(makeInteractionWithLlms([llmA, llmB]));
    const memberA = findMember(inter, 'llmA');
    const memberB = findMember(inter, 'llmB');

    expect(memberA.requestMessagesDelta).toEqual([msg1, msg2]);
    expect(memberB.requestMessagesDelta).toEqual([msg3]);
  });

  it('tool nodes have no delta fields', () => {
    const llm: CanonicalNode = {
      id: 'llm1',
      type: 'llm_request',
      parent: 'root',
      source: 'repl_main_thread',
      model: '',
      tokens_in: 0,
      tokens_out: 0,
      ...span(100, 200),
      request_messages: [msg1],
    };
    const tool: CanonicalNode = {
      id: 'toolA',
      type: 'tool',
      parent: 'root',
      name: 'Read',
      ...span(210, 300),
    };
    const inter = buildInteractionExecution(makeInteractionWithLlms([llm, tool]));
    const toolMember = findMember(inter, 'toolA');
    expect(toolMember.requestMessagesDelta).toBeUndefined();
    expect(toolMember.responseMessagesDelta).toBeUndefined();
  });
});
