import type { ExecutionGraph, ExecutionNode } from '@coach/pipeline';
import { describe, expect, it } from 'vitest';

import type { Highlight } from './highlight.ts';
import { parseHighlight, revealForHighlight } from './highlight.ts';

function node(id: string, children: ExecutionNode[] = []): ExecutionNode {
  return { id, children };
}

// agent ▸ session ▸ interaction ▸ thread with members `llm1` and `toolA`
// (toolA wraps a nested `llm-nested`). Only the shape revealPath walks matters.
function graph(): ExecutionGraph {
  const toolA = node('toolA', [node('llm-nested')]);
  return {
    kind: 'agent',
    nodes: {},
    deltas: {},
    semantics: {},
    actions: {},
    intents: {},
    data: {
      agent: { id: 'agent-1', userId: 'u-1' },
      sessions: [
        {
          session: { id: 'session-1', agentId: 'agent-1', userId: 'u-1', sessionId: 's-1' },
          interactions: [
            {
              interactionId: 'inter-1',
              tree: node('inter-1', [node('llm1'), toolA]),
              threads: [{ id: 'thread-1', source: 'main', members: [node('llm1'), toolA] }],
              causalEdges: [],
            },
          ],
        },
      ],
    },
  };
}

describe('parseHighlight', () => {
  it('returns null when no source/dest/highlight is given', () => {
    expect(parseHighlight({})).toBeNull();
    expect(parseHighlight({ source: '', dest: null, highlight: '  ' })).toBeNull();
  });

  it('maps source and dest to their roles and fits BOTH ids', () => {
    const result = parseHighlight({ source: 'llm1', dest: 'toolA' });
    expect(result).not.toBeNull();
    expect(result?.roles.get('llm1')).toBe('source');
    expect(result?.roles.get('toolA')).toBe('dest');
    expect(result?.fitIds).toEqual(expect.arrayContaining(['llm1', 'toolA']));
    expect(result?.fitIds).toHaveLength(2);
  });

  it('accepts source or dest alone', () => {
    expect(parseHighlight({ source: 'llm1' })?.roles.get('llm1')).toBe('source');
    expect(parseHighlight({ dest: 'toolA' })?.roles.get('toolA')).toBe('dest');
  });

  it('renders a generic highlight list as plain roles, with source/dest winning ties', () => {
    const result = parseHighlight({ highlight: 'a, b , toolA', dest: 'toolA' });
    expect(result?.roles.get('a')).toBe('plain');
    expect(result?.roles.get('b')).toBe('plain');
    expect(result?.roles.get('toolA')).toBe('dest');
  });
});

function highlightOf(params: Parameters<typeof parseHighlight>[0]): Highlight {
  const result = parseHighlight(params);
  if (result == null) throw new Error('expected a non-null highlight');
  return result;
}

describe('revealForHighlight', () => {
  it('unions the ancestors needed for both highlighted ids', () => {
    const reveal = revealForHighlight(graph(), highlightOf({ source: 'llm1', dest: 'llm-nested' }));
    // llm1 needs agent/session/inter; llm-nested additionally needs toolA.
    expect(reveal).toEqual(
      new Set(['agent-1', 'session-1', 'inter-1', 'llm1', 'toolA', 'llm-nested']),
    );
  });

  it('ignores ids not present in the graph', () => {
    const reveal = revealForHighlight(graph(), highlightOf({ source: 'llm1', dest: 'ghost' }));
    expect(reveal).toEqual(new Set(['agent-1', 'session-1', 'inter-1', 'llm1']));
  });
});
