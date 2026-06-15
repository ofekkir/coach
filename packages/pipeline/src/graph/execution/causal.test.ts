import { describe, expect, it } from 'vitest';
import type { CanonicalNode } from '../../types.ts';
import type { GraphEdge } from '../types.ts';
import { buildInteractionExecution } from './execution.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────

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
    source: 'repl_main_thread',
    model: '',
    tokens_in: 0,
    tokens_out: 0,
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
    name: 'Read',
    ...useId('tu_a'),
    ...span(150, 250),
  };
  const toolB: CanonicalNode = {
    id: 'toolB',
    type: 'tool',
    parent: 'root',
    name: 'Grep',
    ...useId('tu_b'),
    ...span(210, 260),
  };
  const inf2: CanonicalNode = {
    id: 'inf2',
    type: 'llm_request',
    parent: 'root',
    source: 'repl_main_thread',
    model: '',
    tokens_in: 0,
    tokens_out: 0,
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

function causalEdgesOf(nodes: CanonicalNode[]): readonly GraphEdge[] {
  const ix = buildInteractionExecution(nodes);
  if (ix == null) throw new Error('expected interaction execution');
  return ix.causalEdges;
}

function edge(edges: readonly GraphEdge[], fromId: string, toId: string): GraphEdge | undefined {
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

  it('makes the user prompt the head of the spine', () => {
    const edges = causalEdgesOf(fixture({ withToolUseIds: true }));
    expect(edge(edges, 'root__prompt', 'inf1')).toBeDefined();
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
});
