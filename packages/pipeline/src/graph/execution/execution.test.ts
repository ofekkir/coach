import { describe, expect, it } from 'vitest';

import { aggregate } from '../../aggregate/aggregate.ts';
import type { CanonicalNode, RequestMessage, ResponseMessage } from '../../types.ts';
import { agentEntityId, sessionEntityId } from '../../types.ts';
import type { AgentExecution, ExecutionGraph, ExecutionNode, Thread } from '../types.ts';
import { deltasOf, nodeData } from '../types.ts';

import { buildExecutionGraph } from './execution.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────

const SID = sessionEntityId('s-1');

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
  sessionId: SID,
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
  sessionId: SID,
  source: 'repl_main_thread',
  model: '',
  tokens_in: 0,
  tokens_out: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  ...span(100, 200),
};

const llm2: CanonicalNode = {
  id: 'llm2',
  type: 'llm_request',
  parent: 'root',
  sessionId: SID,
  source: 'repl_main_thread',
  model: '',
  tokens_in: 0,
  tokens_out: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  ...span(310, 400),
};

const toolAfterLlm1: CanonicalNode = {
  id: 'toolA',
  type: 'tool',
  parent: 'root',
  sessionId: SID,
  name: 'Read',
  ...span(210, 300),
};

// A small forest: one interaction ▸ (llm1, toolA, llm2). Entities (agent/session)
// are synthesized by aggregate from the interaction's session_id/user_id.
function forest(): CanonicalNode[] {
  return [interaction, llm1, toolAfterLlm1, llm2];
}

function buildGraph(nodes: CanonicalNode[]): ExecutionGraph {
  return buildExecutionGraph(aggregate([nodes]));
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

// A tree/thread node is an EDGE — it carries only its id and children, no embedded
// node data (that lives in the `nodes` table, resolved by id).
function assertIdOnly(node: ExecutionNode): void {
  expect(Object.keys(node).sort()).toEqual(['children', 'id']);
  expect(node).not.toHaveProperty('canonical');
  for (const child of node.children) assertIdOnly(child);
}

describe('buildExecutionGraph', () => {
  it('builds kind:agent with entities ▸ interactions ▸ threads ▸ members', () => {
    const graph = buildGraph(forest());
    const agent = soleAgent(graph);
    expect(agent.agent.id).toBe(agentEntityId('u-1'));
    expect(agent.agent.userId).toBe('u-1');
    expect(agent.sessions).toHaveLength(1);

    const session = agent.sessions[0];
    expect(session?.session.id).toBe(SID);
    expect(session?.session.sessionId).toBe('s-1');
    expect(session?.interactions).toHaveLength(1);

    const inter = session?.interactions[0];
    expect(inter?.interactionId).toBe('root');
    expect(inter?.threads).toHaveLength(1);

    const thread = soleThread(agent);
    expect(thread.id).toBe('thread_repl_main_thread');
    expect(thread.source).toBe('repl_main_thread');
    // sorted by start: llm1(100ms), toolA(210ms), llm2(310ms)
    expect(thread.members.map((m) => m.id)).toEqual(['llm1', 'toolA', 'llm2']);
  });

  it('keeps agent and session as entities, NOT rows in the node table', () => {
    const graph = buildGraph(forest());
    expect(graph.nodes[agentEntityId('u-1')]).toBeUndefined();
    expect(graph.nodes[SID]).toBeUndefined();
    // Real nodes ARE in the table.
    expect(graph.nodes.llm1).toBe(llm1);
    expect(graph.nodes.toolA).toBe(toolAfterLlm1);
  });

  it('does not synthesize a prompt node — the prompt is InteractionNode.prompt', () => {
    const graph = buildGraph(forest());
    expect(graph.nodes.root__prompt).toBeUndefined();
    expect(Object.values(graph.nodes).some((n) => n.type === ('user_prompt' as string))).toBe(
      false,
    );
  });

  it('makes every tree/thread node id-only — data resolves through the node table', () => {
    const graph = buildGraph(forest());
    const agent = soleAgent(graph);
    for (const session of agent.sessions) {
      for (const ix of session.interactions) {
        assertIdOnly(ix.tree);
        ix.threads.flatMap((t) => t.members).forEach(assertIdOnly);
      }
    }
    // The id resolves to the very same canonical object that was passed in.
    expect(nodeData(graph, 'llm1')).toBe(llm1);
  });

  it('builds an id-only containment tree rooted at the interaction', () => {
    const graph = buildGraph(forest());
    const inter = soleAgent(graph).sessions[0]?.interactions[0];
    expect(inter?.tree.id).toBe('root');
    expect(inter?.tree.children.map((c) => c.id)).toEqual(['llm1', 'toolA', 'llm2']);
  });

  it('carries the signed gap on causal edges (not on member ordering)', () => {
    const inter = soleAgent(buildGraph(forest())).sessions[0]?.interactions[0];
    // llm1 ends at 200ms, toolA starts at 210ms → +10ms on the causal edge.
    const edge = (inter?.causalEdges ?? []).find((e) => e.fromId === 'llm1' && e.toId === 'toolA');
    expect(edge?.gapMs).toBe(10);
  });

  it('uses plain canonical ids on causal edges (no sg_ prefix)', () => {
    const toolWithChild: CanonicalNode = {
      id: 'twc',
      type: 'tool',
      parent: 'root',
      sessionId: SID,
      name: 'Skill',
      ...span(210, 300),
    };
    const child: CanonicalNode = {
      id: 'child1',
      type: 'tool.execution',
      parent: 'twc',
      sessionId: SID,
      ...span(215, 220),
    };
    const inter = soleAgent(buildGraph([interaction, llm1, toolWithChild, child])).sessions[0]
      ?.interactions[0];
    const edges = inter?.causalEdges ?? [];
    expect(edges.some((e) => e.toId === 'twc')).toBe(true);
    expect(edges.some((e) => e.fromId.startsWith('sg_') || e.toId.startsWith('sg_'))).toBe(false);
  });

  it('preserves nested containment children (id-only) on a tool member', () => {
    const toolWithChild: CanonicalNode = {
      id: 'twc',
      type: 'tool',
      parent: 'root',
      sessionId: SID,
      name: 'Skill',
      ...span(210, 300),
    };
    const child: CanonicalNode = {
      id: 'child1',
      type: 'tool.execution',
      parent: 'twc',
      sessionId: SID,
      ...span(215, 220),
    };
    const graph = buildGraph([interaction, llm1, toolWithChild, child]);
    const inter = soleAgent(graph).sessions[0]?.interactions[0];
    const member = inter?.threads[0]?.members.find((m) => m.id === 'twc');
    expect(member?.children).toHaveLength(1);
    expect(member?.children[0]?.id).toBe('child1');
    expect(nodeData(graph, 'child1')).toBe(child);
  });

  it('produces kind:agent with empty sessions when there is no interaction', () => {
    const graph = buildGraph([llm1]);
    expect(graph.kind).toBe('agent');
    expect(soleAgent(graph).sessions).toHaveLength(0);
  });

  it('round-trips through JSON (plain serializable data, no cycles)', () => {
    const graph = buildGraph(forest());
    const round = JSON.parse(JSON.stringify(graph)) as ExecutionGraph;
    expect(round.nodes.llm1).toEqual(llm1);
    expect(round.kind).toBe('agent');
  });
});

// ── Message delta tests (now in the graph-level `deltas` table, keyed by id) ─────

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
      sessionId: SID,
      session_id: 's-1',
      user_id: 'u-1',
      sequence: 0,
      prompt: 'test',
      ...span(90, 500),
    },
    ...llmNodes,
  ];
}

function llm(over: Partial<CanonicalNode> & { id: string }): CanonicalNode {
  return {
    type: 'llm_request',
    parent: 'root',
    sessionId: SID,
    source: 'repl_main_thread',
    model: '',
    tokens_in: 0,
    tokens_out: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    ...span(100, 200),
    ...over,
  } as CanonicalNode;
}

describe('message deltas in the deltas table', () => {
  it('first llm_request in thread gets its full request_messages as delta', () => {
    const node = llm({ id: 'llm1', request_messages: [msg1], response_messages: resMsgs1 });
    const graph = buildGraph(makeInteractionWithLlms([node]));
    expect(deltasOf(graph, 'llm1')?.requestMessagesDelta).toEqual([msg1]);
    expect(deltasOf(graph, 'llm1')?.responseMessagesDelta).toEqual(resMsgs1);
  });

  it('subsequent llm_request gets suffix beyond previous request as delta', () => {
    const a = llm({ id: 'llmA', request_messages: [msg1, msg2], response_messages: resMsgs1 });
    const b = llm({
      id: 'llmB',
      ...span(300, 400),
      request_messages: [msg1, msg2, msg3],
      response_messages: resMsgs2,
    });
    const graph = buildGraph(makeInteractionWithLlms([a, b]));
    expect(deltasOf(graph, 'llmA')?.requestMessagesDelta).toEqual([msg1, msg2]);
    expect(deltasOf(graph, 'llmB')?.requestMessagesDelta).toEqual([msg3]);
    expect(deltasOf(graph, 'llmB')?.responseMessagesDelta).toEqual(resMsgs2);
  });

  it('native format: each llm_request carries only new messages as delta', () => {
    const a = llm({ id: 'llmA', request_messages: [msg1, msg2], response_messages: resMsgs1 });
    // Native: only the new message, not the full cumulative history.
    const b = llm({
      id: 'llmB',
      ...span(300, 400),
      request_messages: [msg3],
      response_messages: resMsgs2,
    });
    const graph = buildGraph(makeInteractionWithLlms([a, b]));
    expect(deltasOf(graph, 'llmA')?.requestMessagesDelta).toEqual([msg1, msg2]);
    expect(deltasOf(graph, 'llmB')?.requestMessagesDelta).toEqual([msg3]);
  });

  it('tool nodes have no delta row', () => {
    const node = llm({ id: 'llm1', request_messages: [msg1] });
    const tool: CanonicalNode = {
      id: 'toolA',
      type: 'tool',
      parent: 'root',
      sessionId: SID,
      name: 'Read',
      ...span(210, 300),
    };
    const graph = buildGraph(makeInteractionWithLlms([node, tool]));
    expect(deltasOf(graph, 'toolA')).toBeUndefined();
  });
});
