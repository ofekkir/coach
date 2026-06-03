import { describe, expect, it } from 'vitest';
import type { CanonicalNode } from '../../types.ts';
import type { AgentExecution, ExecutionGraph, ExecutionNode, Thread } from '../types.ts';
import { buildExecutionGraph, buildInteractionExecution } from './execution.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────

const interaction: CanonicalNode = { id: 'root', type: 'interaction', prompt: 'hello' };

const llm1: CanonicalNode = {
  id: 'llm1',
  type: 'llm_request',
  parent: 'root',
  source: 'repl_main_thread',
  start_time_ns: '100000000',
  end_time_ns: '200000000',
};

const llm2: CanonicalNode = {
  id: 'llm2',
  type: 'llm_request',
  parent: 'root',
  source: 'repl_main_thread',
  start_time_ns: '310000000',
  end_time_ns: '400000000',
};

const toolAfterLlm1: CanonicalNode = {
  id: 'toolA',
  type: 'tool',
  parent: 'root',
  name: 'Read',
  start_time_ns: '210000000',
  end_time_ns: '300000000',
};

// A small full agent forest: agent ▸ session ▸ interaction ▸ (llm1, toolA, llm2).
function agentForest(): CanonicalNode[] {
  const agent: CanonicalNode = { id: 'agent', type: 'agent', user_id: 'u1' };
  const session: CanonicalNode = {
    id: 'sess',
    type: 'session',
    parent: 'agent',
    session_id: 's-123',
    start_time_ns: '50000000',
  };
  const inter: CanonicalNode = {
    ...interaction,
    parent: 'sess',
    start_time_ns: '90000000',
  };
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

  it('embeds the full CanonicalNode losslessly on every node', () => {
    const agent = soleAgent(buildExecutionGraph(agentForest()));

    const llm1Node = soleThread(agent).members.find((m) => m.id === 'llm1');
    expect(llm1Node?.canonical).toBe(llm1);
    expect(llm1Node?.canonical.source).toBe('repl_main_thread');

    everyNode(agent).forEach(assertClean);
  });

  it('carries gapMs as a signed number on thread edges', () => {
    const graph = buildExecutionGraph(agentForest());
    if (graph.kind !== 'agent') throw new Error('expected agent');

    const edges = graph.data.sessions[0]?.interactions[0]?.threads[0]?.edges ?? [];
    // llm1 ends at 200ms, toolA starts at 210ms → +10ms
    const edge = edges.find((e) => e.fromId === 'llm1' && e.toId === 'toolA');
    expect(edge?.gapMs).toBe(10);
    expect(typeof edge?.gapMs).toBe('number');
  });

  it('uses plain canonical ids on edges (no sg_ prefix)', () => {
    const toolWithChild: CanonicalNode = {
      id: 'twc',
      type: 'tool',
      parent: 'root',
      name: 'Skill',
      start_time_ns: '210000000',
      end_time_ns: '300000000',
    };
    const child: CanonicalNode = {
      id: 'child1',
      type: 'tool.execution',
      parent: 'twc',
      start_time_ns: '215000000',
    };
    const inter = buildInteractionExecution([interaction, llm1, toolWithChild, child]);
    const thread = inter?.threads.find((t) => t.id === 'thread_repl_main_thread');
    const edge = thread?.edges.find((e) => e.toId === 'twc');
    expect(edge?.fromId).toBe('llm1');
    expect(thread?.edges.some((e) => e.fromId.startsWith('sg_') || e.toId.startsWith('sg_'))).toBe(
      false,
    );
  });

  it('preserves nested children on container nodes', () => {
    const toolWithChild: CanonicalNode = {
      id: 'twc',
      type: 'tool',
      parent: 'root',
      name: 'Skill',
      start_time_ns: '210000000',
      end_time_ns: '300000000',
    };
    const child: CanonicalNode = {
      id: 'child1',
      type: 'tool.execution',
      parent: 'twc',
      start_time_ns: '215000000',
    };
    const inter = buildInteractionExecution([interaction, llm1, toolWithChild, child]);
    const member = inter?.threads[0]?.members.find((m) => m.id === 'twc');
    expect(member?.children).toHaveLength(1);
    expect(member?.children[0]?.id).toBe('child1');
    expect(member?.children[0]?.canonical).toBe(child);
  });

  it('degrades to kind:session when no agent node is present', () => {
    const session: CanonicalNode = { id: 'sess', type: 'session', session_id: 's-1' };
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
