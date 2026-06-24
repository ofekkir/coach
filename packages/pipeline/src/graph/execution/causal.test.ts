import { describe, expect, it } from 'vitest';

import { aggregate } from '../../aggregate/aggregate.ts';
import type { CanonicalNode } from '../../types.ts';
import { sessionEntityId } from '../../types.ts';
import type { CausalEdge, InteractionExecution } from '../types.ts';

import { buildExecutionGraph } from './execution.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────

const SID = sessionEntityId('s-1');

function span(startMs: number, endMs: number) {
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

// One inference emits two parallel tool calls, then a second inference consumes
// both their results. toolA starts BEFORE inf1 ends (streamed/eager dispatch) →
// its fan-out gap is negative. toolB starts after inf1 ends → positive.
function fixture(opts: { withToolUseIds: boolean }): CanonicalNode[] {
  const useId = (id: string) => (opts.withToolUseIds ? { tool_use_id: id } : {});
  const inf1: CanonicalNode = {
    id: 'inf1',
    type: 'llm_request',
    parent: 'root',
    sessionId: SID,
    source: 'repl_main_thread',
    model: '',
    tokens_in: 0,
    tokens_out: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    request_messages: [{ role: 'user', content: 'hello' }],
    response_messages: [
      { type: 'tool_use', id: 'tu_a', name: 'Read' },
      { type: 'tool_use', id: 'tu_b', name: 'Grep' },
    ],
    ...span(100, 200),
  };
  const toolA: CanonicalNode = {
    id: 'toolA',
    type: 'tool',
    parent: 'root',
    sessionId: SID,
    name: 'Read',
    ...useId('tu_a'),
    ...span(150, 250),
  };
  const toolB: CanonicalNode = {
    id: 'toolB',
    type: 'tool',
    parent: 'root',
    sessionId: SID,
    name: 'Grep',
    ...useId('tu_b'),
    ...span(210, 260),
  };
  const inf2: CanonicalNode = {
    id: 'inf2',
    type: 'llm_request',
    parent: 'root',
    sessionId: SID,
    source: 'repl_main_thread',
    model: '',
    tokens_in: 0,
    tokens_out: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    request_messages: [
      { role: 'user', content: 'hello' },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_a' },
          { type: 'tool_result', tool_use_id: 'tu_b' },
        ],
      },
    ],
    response_messages: [{ type: 'text', text: 'done' }],
    ...span(300, 400),
  };
  return [interaction, inf1, toolA, toolB, inf2];
}

function soleInteraction(nodes: CanonicalNode[]): InteractionExecution {
  const graph = buildExecutionGraph(aggregate([nodes]));
  if (graph.kind !== 'agent') throw new Error('expected agent graph');
  const ix = graph.data.sessions[0]?.interactions[0];
  if (ix == null) throw new Error('expected interaction execution');
  return ix;
}

function causalEdgesOf(nodes: CanonicalNode[]): readonly CausalEdge[] {
  return soleInteraction(nodes).causalEdges;
}

function edge(edges: readonly CausalEdge[], fromId: string, toId: string): CausalEdge | undefined {
  return edges.find((e) => e.fromId === fromId && e.toId === toId);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('buildCausalEdges', () => {
  it('fans out from one inference to each parallel tool it emitted (no tool→tool chain)', () => {
    const edges = causalEdgesOf(fixture({ withToolUseIds: true }));
    expect(edge(edges, 'inf1', 'toolA')).toBeDefined();
    expect(edge(edges, 'inf1', 'toolB')).toBeDefined();
    // Parallel tools branch from the inference — they are NOT chained to each other.
    expect(edge(edges, 'toolA', 'toolB')).toBeUndefined();
  });

  it('fans in from each tool result to the consuming inference', () => {
    const edges = causalEdgesOf(fixture({ withToolUseIds: true }));
    expect(edge(edges, 'toolA', 'inf2')).toBeDefined();
    expect(edge(edges, 'toolB', 'inf2')).toBeDefined();
  });

  it('makes the first inference a spine root — no prompt node feeds it', () => {
    const edges = causalEdgesOf(fixture({ withToolUseIds: true }));
    expect(edges.some((e) => e.toId === 'inf1')).toBe(false);
    expect(edges.some((e) => e.fromId === 'root__prompt')).toBe(false);
  });

  it('carries a negative fan-out gap when a tool starts before the inference ends', () => {
    const edges = causalEdgesOf(fixture({ withToolUseIds: true }));
    // toolA starts at 150ms, inf1 ends at 200ms → -50ms (dispatched mid-stream)
    expect(edge(edges, 'inf1', 'toolA')?.gapMs).toBe(-50);
    // toolB starts at 210ms, inf1 ends at 200ms → +10ms
    expect(edge(edges, 'inf1', 'toolB')?.gapMs).toBe(10);
  });

  it('carries a positive fan-in gap from tool end to the next inference start', () => {
    const edges = causalEdgesOf(fixture({ withToolUseIds: true }));
    // toolA ends at 250ms, inf2 starts at 300ms → +50ms
    expect(edge(edges, 'toolA', 'inf2')?.gapMs).toBe(50);
  });

  it('falls back to a positional chain when no tool carries a tool_use_id', () => {
    const edges = causalEdgesOf(fixture({ withToolUseIds: false }));
    // No id correlation → no fan-in branching; the spine degrades to time order.
    expect(edge(edges, 'toolA', 'toolB')).toBeDefined();
    expect(edge(edges, 'toolA', 'inf2')).toBeUndefined();
  });

  // A background loop (different source/thread) carries the main thread's history
  // in its request — but it does not CAUSALLY consume those tool results. Fan-in
  // must not reach across threads.
  it('does not fan in across threads when a background loop echoes a tool result', () => {
    const mainInf: CanonicalNode = {
      id: 'mainInf',
      type: 'llm_request',
      parent: 'root',
      sessionId: SID,
      source: 'repl_main_thread',
      model: '',
      tokens_in: 0,
      tokens_out: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      response_messages: [{ type: 'tool_use', id: 'tu_x', name: 'Read' }],
      ...span(100, 200),
    };
    const tool: CanonicalNode = {
      id: 'toolX',
      type: 'tool',
      parent: 'root',
      sessionId: SID,
      name: 'Read',
      tool_use_id: 'tu_x',
      ...span(210, 250),
    };
    const bgInf: CanonicalNode = {
      id: 'bgInf',
      type: 'llm_request',
      parent: 'root',
      sessionId: SID,
      source: 'away_summary',
      model: '',
      tokens_in: 0,
      tokens_out: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      // The background loop's request echoes the main thread's tool_result history.
      request_messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_x' }] }],
      ...span(9000, 9100),
    };
    const edges = causalEdgesOf([interaction, mainInf, tool, bgInf]);
    expect(edge(edges, 'mainInf', 'toolX')).toBeDefined(); // fan-out, same thread
    expect(edge(edges, 'toolX', 'bgInf')).toBeUndefined(); // no cross-thread fan-in
  });

  // A tool's wait and execution sub-spans start together (overlapping), so they
  // are parallel children of the tool — not a wait → execution sequence.
  it('links a tool to its wait and execution sub-spans in parallel (not wait→exec)', () => {
    const inf: CanonicalNode = {
      id: 'inf',
      type: 'llm_request',
      parent: 'root',
      sessionId: SID,
      source: 'repl_main_thread',
      model: '',
      tokens_in: 0,
      tokens_out: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      response_messages: [{ type: 'tool_use', id: 'tu_x', name: 'Read' }],
      ...span(100, 200),
    };
    const tool: CanonicalNode = {
      id: 'toolX',
      type: 'tool',
      parent: 'root',
      sessionId: SID,
      name: 'Read',
      tool_use_id: 'tu_x',
      ...span(210, 260),
    };
    const wait: CanonicalNode = {
      id: 'waitX',
      type: 'tool.blocked_on_user',
      parent: 'toolX',
      sessionId: SID,
      ...span(211, 212),
    };
    const exec: CanonicalNode = {
      id: 'execX',
      type: 'tool.execution',
      parent: 'toolX',
      sessionId: SID,
      ...span(212, 260),
    };
    const edges = causalEdgesOf([interaction, inf, tool, wait, exec]);
    expect(edge(edges, 'toolX', 'waitX')).toBeDefined();
    expect(edge(edges, 'toolX', 'execX')).toBeDefined();
    expect(edge(edges, 'waitX', 'execX')).toBeUndefined();
    // Gap is measured from the tool's START (nested child), not its end:
    // wait starts at 211ms, tool at 210ms → +1ms (end-based would read -49ms).
    expect(edge(edges, 'toolX', 'waitX')?.gapMs).toBe(1);
    expect(edge(edges, 'toolX', 'execX')?.gapMs).toBe(2);
  });
});
