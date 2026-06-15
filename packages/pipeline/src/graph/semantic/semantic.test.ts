import { describe, expect, it } from 'vitest';
import type { CanonicalNode } from '../../types.ts';
import type { ExecutionGraph } from '../types.ts';
import { resolveNode } from '../types.ts';
import { defaultSemanticsConfig } from '@coach/semantics';
import { enrichExecutionGraph } from './semantic.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const agent: CanonicalNode = { id: 'agent', type: 'agent', user_id: 'u1' };
const session: CanonicalNode = {
  id: 'sess',
  type: 'session',
  parent: 'agent',
  session_id: 's-1',
  user_id: 'u-1',
};
const interaction: CanonicalNode = {
  id: 'inter',
  type: 'interaction',
  parent: 'sess',
  session_id: 's-1',
  user_id: 'u-1',
  sequence: 0,
  prompt: 'do something',
  start_time_ns: '90000000',
  end_time_ns: '500000000',
  duration_ms: 410,
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
  duration_ms: 100,
};
const tool1: CanonicalNode = {
  id: 'tool1',
  type: 'tool',
  parent: 'inter',
  name: 'Bash',
  // real traces carry JSON tool_input; `description` is the agent's own intent annotation
  tool_input: '{"command":"pnpm test","description":"Run the test suite"}',
  start_time_ns: '210000000',
  end_time_ns: '300000000',
  duration_ms: 90,
};

function makeGraph(): ExecutionGraph {
  return {
    kind: 'agent',
    nodes: { agent, sess: session, inter: interaction, llm1, tool1 },
    data: {
      root: { id: 'agent', children: [] },
      sessions: [
        {
          root: { id: 'sess', children: [] },
          interactions: [
            {
              root: { id: 'inter', children: [] },
              userPrompt: null,
              rootToThreadIds: ['thread_repl_main_thread'],
              causalEdges: [{ fromId: 'llm1', toId: 'tool1', gapMs: 10 }],
              threads: [
                {
                  id: 'thread_repl_main_thread',
                  source: 'repl_main_thread',
                  members: [
                    {
                      id: 'llm1',
                      children: [],
                      requestMessagesDelta: [{ role: 'user', content: 'What should I do next?' }],
                      responseMessagesDelta: [{ type: 'text', text: 'You should run the tests.' }],
                    },
                    { id: 'tool1', children: [] },
                  ],
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
  it('derives tool intent and labels a terminal assistant message as respond', () => {
    const enriched = enrichExecutionGraph(makeGraph(), defaultSemanticsConfig);

    // The final text turn (no trailing tool call) gets the generic deterministic
    // respond act — no model classifies it more finely.
    expect(resolveNode(enriched, 'llm1')).toMatchObject({ type: 'inference', what: ['respond'] });
    // `what` is the derived label; `comment` is the agent's verbatim description (display only)
    expect(resolveNode(enriched, 'tool1')).toMatchObject({
      type: 'action',
      what: ['bash'],
      comment: 'Run the test suite',
    });
  });

  it('preserves graph structure: ids, edges, hierarchy, and non-tool nodes', () => {
    const enriched = enrichExecutionGraph(makeGraph(), defaultSemanticsConfig);
    if (enriched.kind !== 'agent') throw new Error('expected agent');

    const data = enriched.data;
    expect(data.root.id).toBe('agent');
    expect(resolveNode(enriched, 'agent').type).toBe('agent'); // unchanged

    const sess = data.sessions[0];
    expect(sess?.root.id).toBe('sess');

    const ix = sess?.interactions[0];
    expect(resolveNode(enriched, 'inter').type).toBe('interaction');
    expect(ix?.rootToThreadIds).toEqual(['thread_repl_main_thread']);

    const thread = ix?.threads[0];
    expect(thread?.id).toBe('thread_repl_main_thread');
    // Causal edges survive enrichment unchanged (node relabeling doesn't touch them).
    expect(ix?.causalEdges[0]).toEqual({ fromId: 'llm1', toId: 'tool1', gapMs: 10 });
  });

  it('preserves existing canonical fields on converted nodes', () => {
    const enriched = enrichExecutionGraph(makeGraph(), defaultSemanticsConfig);

    expect(resolveNode(enriched, 'llm1')).toMatchObject({
      tokens_in: 100,
      tokens_out: 20,
      model: 'claude-haiku',
    });
  });

  it('returns the graph content unchanged when there are no tool or llm_request nodes', () => {
    const emptyGraph: ExecutionGraph = { kind: 'interaction', nodes: {}, data: null };
    const result = enrichExecutionGraph(emptyGraph, defaultSemanticsConfig);
    expect(result).toEqual(emptyGraph); // nothing to enrich
  });

  it('labels session-title calls deterministically (marker short-circuit)', () => {
    const titleLlm: CanonicalNode = { ...llm1, id: 'title1' };
    const graph: ExecutionGraph = {
      kind: 'interaction',
      nodes: { inter: interaction, title1: titleLlm },
      data: {
        root: { id: 'inter', children: [] },
        userPrompt: null,
        rootToThreadIds: ['t'],
        causalEdges: [],
        threads: [
          {
            id: 't',
            source: 'repl_main_thread',
            members: [
              {
                id: 'title1',
                children: [],
                requestMessagesDelta: [
                  { role: 'user', content: '<session>\nadd an mcp\n</session>' },
                ],
                responseMessagesDelta: [
                  { type: 'text', text: '{"title": "Add Grafana MCP server"}' },
                ],
              },
            ],
          },
        ],
      },
    };
    const enriched = enrichExecutionGraph(graph, defaultSemanticsConfig);

    expect(resolveNode(enriched, 'title1')).toMatchObject({
      type: 'inference',
      what: ['generate session title'],
    });
  });

  it('labels nodes with no message delta with the model-id fallback', () => {
    const emptyLlm: CanonicalNode = { ...llm1, id: 'empty1' };
    const graph: ExecutionGraph = {
      kind: 'interaction',
      nodes: { inter: interaction, empty1: emptyLlm },
      data: {
        root: { id: 'inter', children: [] },
        userPrompt: null,
        rootToThreadIds: ['t'],
        causalEdges: [],
        threads: [
          {
            id: 't',
            source: 'repl_main_thread',
            // no requestMessagesDelta / responseMessagesDelta — nothing to read
            members: [{ id: 'empty1', children: [] }],
          },
        ],
      },
    };
    const enriched = enrichExecutionGraph(graph, defaultSemanticsConfig);

    expect(resolveNode(enriched, 'empty1')).toMatchObject({
      type: 'inference',
      what: ['claude-haiku'],
    });
  });
});
