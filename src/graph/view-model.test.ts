import { describe, expect, it } from 'vitest';
import type { TraceNode } from '../etl/types.ts';
import { buildCausalGraphView, buildCompositionGraphView } from './view-model.ts';

const interaction: TraceNode = {
  id: 'root',
  type: 'interaction',
  prompt: 'hello',
};

const llm1: TraceNode = {
  id: 'llm1',
  type: 'llm_request',
  parent: 'root',
  source: 'repl_main_thread',
  start_time_ns: '100000000',
  end_time_ns: '200000000',
};

const llm2: TraceNode = {
  id: 'llm2',
  type: 'llm_request',
  parent: 'root',
  source: 'repl_main_thread',
  start_time_ns: '310000000',
  end_time_ns: '400000000',
};

const bgLlm: TraceNode = {
  id: 'bgLlm',
  type: 'llm_request',
  parent: 'root',
  source: 'background',
  start_time_ns: '150000000',
  end_time_ns: '500000000',
};

const toolAfterLlm1: TraceNode = {
  id: 'toolA',
  type: 'tool',
  parent: 'root',
  name: 'Read',
  start_time_ns: '210000000',
  end_time_ns: '300000000',
};

describe('buildCausalGraphView', () => {
  it('returns null when there is no interaction node', () => {
    expect(buildCausalGraphView([llm1])).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(buildCausalGraphView([])).toBeNull();
  });

  it('returns a view with the interaction as root', () => {
    const view = buildCausalGraphView([interaction, llm1]);
    expect(view).not.toBeNull();
    expect(view?.root.id).toBe('root');
    expect(view?.root.children).toHaveLength(0);
  });

  it('groups llm_requests by source into threads', () => {
    const view = buildCausalGraphView([interaction, llm1, llm2]);
    expect(view?.threads).toHaveLength(1);
    expect(view?.threads[0]?.id).toBe('thread_repl_main_thread');
    expect(view?.threads[0]?.members).toHaveLength(2);
  });

  it('creates separate threads for distinct sources', () => {
    const view = buildCausalGraphView([interaction, llm1, bgLlm]);
    expect(view?.threads).toHaveLength(2);
    const ids = view?.threads.map((t) => t.id) ?? [];
    expect(ids).toContain('thread_repl_main_thread');
    expect(ids).toContain('thread_background');
  });

  it('orders threads by earliest member start time', () => {
    // bgLlm starts at 150ms, llm1 starts at 100ms — repl_main_thread should be first
    const view = buildCausalGraphView([interaction, llm1, bgLlm]);
    expect(view?.threads[0]?.id).toBe('thread_repl_main_thread');
  });

  it('orders members within a thread by start time', () => {
    // llm2 starts after llm1 — llm1 must come first
    const view = buildCausalGraphView([interaction, llm2, llm1]);
    const members = view?.threads[0]?.members ?? [];
    expect(members[0]?.id).toBe('llm1');
    expect(members[1]?.id).toBe('llm2');
  });

  it('a tool node with children becomes a GraphViewNode with non-empty children', () => {
    const toolWithChild: TraceNode = {
      id: 'twc',
      type: 'tool',
      parent: 'root',
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
    const view = buildCausalGraphView([interaction, llm1, toolWithChild, child]);
    const thread = view?.threads.find((t) => t.id === 'thread_repl_main_thread');
    const toolMember = thread?.members.find((m) => m.id === 'twc');
    expect(toolMember?.children).toHaveLength(1);
    expect(toolMember?.children[0]?.id).toBe('child1');
  });

  it('thread-level edges referencing a container node use the sg_<id> prefix', () => {
    const toolWithChild: TraceNode = {
      id: 'twc',
      type: 'tool',
      parent: 'root',
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
    // llm1 ends at 200ms, toolWithChild starts at 210ms → toolWithChild goes to repl_main_thread after llm1
    const view = buildCausalGraphView([interaction, llm1, toolWithChild, child]);
    const thread = view?.threads.find((t) => t.id === 'thread_repl_main_thread');
    // edge from llm1 → twc; twc has children so it becomes sg_twc
    const edgeToTwc = thread?.edges.find((e) => e.toId === 'sg_twc');
    expect(edgeToTwc).toBeDefined();
    expect(edgeToTwc?.fromId).toBe('llm1');
  });

  it('gap labels appear on thread-level edges', () => {
    // llm1 ends at 200ms, toolAfterLlm1 starts at 210ms → gap of +10ms
    const view = buildCausalGraphView([interaction, llm1, toolAfterLlm1, llm2]);
    const thread = view?.threads.find((t) => t.id === 'thread_repl_main_thread');
    const edgeFromLlm1 = thread?.edges.find((e) => e.fromId === 'llm1');
    expect(edgeFromLlm1?.label).toBe('+10ms');
  });

  it('inner edges (inside containers) have no gap label', () => {
    const toolWithChild: TraceNode = {
      id: 'twc',
      type: 'tool',
      parent: 'root',
      name: 'Skill',
      start_time_ns: '210000000',
      end_time_ns: '300000000',
    };
    const child1: TraceNode = {
      id: 'ch1',
      type: 'tool.blocked_on_user',
      parent: 'twc',
      start_time_ns: '215000000',
      end_time_ns: '220000000',
    };
    const child2: TraceNode = {
      id: 'ch2',
      type: 'tool.execution',
      parent: 'twc',
      start_time_ns: '230000000',
    };
    const view = buildCausalGraphView([interaction, llm1, toolWithChild, child1, child2]);
    const thread = view?.threads.find((t) => t.id === 'thread_repl_main_thread');
    const toolMember = thread?.members.find((m) => m.id === 'twc');
    for (const edge of toolMember?.innerEdges ?? []) {
      expect(edge.label).toBeUndefined();
    }
  });

  it('rootToThreadIds contains all thread ids in order', () => {
    const view = buildCausalGraphView([interaction, llm1, bgLlm]);
    expect(view?.rootToThreadIds).toEqual(view?.threads.map((t) => t.id));
  });
});

describe('buildCompositionGraphView', () => {
  it('returns a node for each input TraceNode', () => {
    const view = buildCompositionGraphView([interaction, llm1]);
    expect(view.nodes).toHaveLength(2);
    expect(view.nodes.map((n) => n.id)).toContain('root');
    expect(view.nodes.map((n) => n.id)).toContain('llm1');
  });

  it('returns edges only for nodes with a parent', () => {
    const view = buildCompositionGraphView([interaction, llm1]);
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0]?.fromId).toBe('root');
    expect(view.edges[0]?.toId).toBe('llm1');
  });

  it('nodes have empty children and innerEdges', () => {
    const view = buildCompositionGraphView([interaction]);
    expect(view.nodes[0]?.children).toHaveLength(0);
    expect(view.nodes[0]?.innerEdges).toHaveLength(0);
  });
});
