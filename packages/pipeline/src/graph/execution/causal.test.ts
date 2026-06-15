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
  it('fans out from an inference to each tool it emitted', () => {
    const edges = causalEdgesOf(fixture({ withToolUseIds: true }));
    expect(edge(edges, 'inf1', 'toolA')?.kind).toBe('causal');
    expect(edge(edges, 'inf1', 'toolB')?.kind).toBe('causal');
  });

  it('fans in from each tool result to the consuming inference', () => {
    const edges = causalEdgesOf(fixture({ withToolUseIds: true }));
    expect(edge(edges, 'toolA', 'inf2')?.kind).toBe('causal');
    expect(edge(edges, 'toolB', 'inf2')?.kind).toBe('causal');
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

  it('produces no causal edges when no tool carries a tool_use_id', () => {
    expect(causalEdgesOf(fixture({ withToolUseIds: false }))).toEqual([]);
  });
});
