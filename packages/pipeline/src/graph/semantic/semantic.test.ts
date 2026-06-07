import { describe, expect, it, vi } from 'vitest';
import type { CanonicalNode } from '../../types.ts';
import type { ExecutionGraph } from '../types.ts';
import type { LabelBatchFn, LabelRequest } from './semantic.ts';
import { enrichExecutionGraph } from './semantic.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const agent: CanonicalNode = { id: 'agent', type: 'agent', user_id: 'u1' };
const session: CanonicalNode = { id: 'sess', type: 'session', parent: 'agent', session_id: 's-1' };
const interaction: CanonicalNode = {
  id: 'inter',
  type: 'interaction',
  parent: 'sess',
  prompt: 'do something',
};
const llm1: CanonicalNode = {
  id: 'llm1',
  type: 'llm_request',
  parent: 'inter',
  source: 'repl_main_thread',
  model: 'claude-haiku',
  request_messages: [{ role: 'user', content: 'What should I do next?' }],
  response_messages: [{ type: 'text', text: 'You should run the tests.' }],
  tokens_in: 100,
  tokens_out: 20,
  start_time_ns: '100000000',
  end_time_ns: '200000000',
};
const tool1: CanonicalNode = {
  id: 'tool1',
  type: 'tool',
  parent: 'inter',
  name: 'Bash',
  tool_input: 'pnpm test',
  start_time_ns: '210000000',
  end_time_ns: '300000000',
};

function makeGraph(): ExecutionGraph {
  return {
    kind: 'agent',
    data: {
      root: { id: 'agent', canonical: agent, children: [], innerEdges: [] },
      sessions: [
        {
          root: { id: 'sess', canonical: session, children: [], innerEdges: [] },
          interactions: [
            {
              root: { id: 'inter', canonical: interaction, children: [], innerEdges: [] },
              userPrompt: null,
              rootToThreadIds: ['thread_repl_main_thread'],
              threads: [
                {
                  id: 'thread_repl_main_thread',
                  source: 'repl_main_thread',
                  members: [
                    {
                      id: 'llm1',
                      canonical: llm1,
                      children: [],
                      innerEdges: [],
                      requestMessagesDelta: [{ role: 'user', content: 'What should I do next?' }],
                      responseMessagesDelta: [{ type: 'text', text: 'You should run the tests.' }],
                    },
                    { id: 'tool1', canonical: tool1, children: [], innerEdges: [] },
                  ],
                  edges: [{ fromId: 'llm1', toId: 'tool1', gapMs: 10 }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('enrichExecutionGraph', () => {
  it('converts tool → action and llm_request → inference with provided labels', async () => {
    const labelBatch: LabelBatchFn = (requests) => {
      const map = new Map<string, string>();
      for (const r of requests) {
        map.set(r.id, r.kind === 'tool' ? 'run tests' : 'plan next steps');
      }
      return Promise.resolve(map);
    };

    const enriched = await enrichExecutionGraph(makeGraph(), labelBatch);
    if (enriched.kind !== 'agent') throw new Error('expected agent');

    const thread = enriched.data.sessions[0]?.interactions[0]?.threads[0];
    const llmNode = thread?.members.find((m) => m.id === 'llm1');
    const toolNode = thread?.members.find((m) => m.id === 'tool1');

    expect(llmNode?.canonical.type).toBe('inference');
    expect(llmNode?.canonical.what).toBe('plan next steps');
    expect(toolNode?.canonical.type).toBe('action');
    expect(toolNode?.canonical.what).toBe('run tests');
  });

  it('falls back to tool name when label is missing', async () => {
    const labelBatch: LabelBatchFn = () => Promise.resolve(new Map<string, string>()); // empty — no labels
    const enriched = await enrichExecutionGraph(makeGraph(), labelBatch);
    if (enriched.kind !== 'agent') throw new Error('expected agent');

    const thread = enriched.data.sessions[0]?.interactions[0]?.threads[0];
    const toolNode = thread?.members.find((m) => m.id === 'tool1');
    const llmNode = thread?.members.find((m) => m.id === 'llm1');

    expect(toolNode?.canonical.type).toBe('action');
    expect(toolNode?.canonical.what).toBe('Bash'); // tool.name fallback
    expect(llmNode?.canonical.type).toBe('inference');
    expect(llmNode?.canonical.what).toBe('claude-haiku'); // model fallback
  });

  it('preserves graph structure: ids, edges, hierarchy, and non-tool nodes', async () => {
    const labelBatch: LabelBatchFn = (requests) =>
      Promise.resolve(new Map(requests.map((r) => [r.id, 'label'])));
    const enriched = await enrichExecutionGraph(makeGraph(), labelBatch);
    if (enriched.kind !== 'agent') throw new Error('expected agent');

    const data = enriched.data;
    expect(data.root.id).toBe('agent');
    expect(data.root.canonical.type).toBe('agent'); // unchanged

    const sess = data.sessions[0];
    expect(sess?.root.id).toBe('sess');

    const ix = sess?.interactions[0];
    expect(ix?.root.canonical.type).toBe('interaction');
    expect(ix?.rootToThreadIds).toEqual(['thread_repl_main_thread']);

    const thread = ix?.threads[0];
    expect(thread?.id).toBe('thread_repl_main_thread');
    expect(thread?.edges[0]).toEqual({ fromId: 'llm1', toId: 'tool1', gapMs: 10 });
  });

  it('preserves existing canonical fields on converted nodes', async () => {
    const labelBatch: LabelBatchFn = (requests) =>
      Promise.resolve(new Map(requests.map((r) => [r.id, 'label'])));
    const enriched = await enrichExecutionGraph(makeGraph(), labelBatch);
    if (enriched.kind !== 'agent') throw new Error('expected agent');

    const thread = enriched.data.sessions[0]?.interactions[0]?.threads[0];
    const llmNode = thread?.members.find((m) => m.id === 'llm1');

    expect(llmNode?.canonical.tokens_in).toBe(100);
    expect(llmNode?.canonical.tokens_out).toBe(20);
    expect(llmNode?.canonical.model).toBe('claude-haiku');
  });

  it('only calls labelBatch once for all nodes in the graph', async () => {
    const labelBatch = vi.fn((requests: readonly LabelRequest[]) =>
      Promise.resolve(new Map(requests.map((r) => [r.id, 'x']))),
    );
    await enrichExecutionGraph(makeGraph(), labelBatch);
    expect(labelBatch).toHaveBeenCalledTimes(1);
    expect(labelBatch.mock.calls[0]?.[0]).toHaveLength(2); // llm1 + tool1
  });

  it('returns the graph unchanged when there are no tool or llm_request nodes', async () => {
    const emptyGraph: ExecutionGraph = { kind: 'interaction', data: null };
    const labelBatch = vi.fn(() => Promise.resolve(new Map<string, string>()));
    const result = await enrichExecutionGraph(emptyGraph, labelBatch);
    expect(result).toBe(emptyGraph); // same reference — nothing to enrich
    expect(labelBatch).not.toHaveBeenCalled();
  });
});
