import type { ExecutionGraph, ExecutionNode } from '@coach/pipeline';
import { describe, expect, it } from 'vitest';

import { revealPath } from './queries.ts';

function node(id: string, children: ExecutionNode[] = []): ExecutionNode {
  return { id, children };
}

// A minimal agent graph: agent ▸ session ▸ interaction ▸ one thread whose member
// `toolA` contains a nested `llm-nested` child. Only the shape revealPath walks
// matters here, so the node tables stay empty.
function graph(): ExecutionGraph {
  const toolA = node('toolA', [node('llm-nested')]);
  return {
    kind: 'agent',
    nodes: {},
    deltas: {},
    semantics: {},
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

describe('revealPath', () => {
  it('returns just the root for the agent id', () => {
    expect(revealPath(graph(), 'agent-1')).toEqual(new Set(['agent-1']));
  });

  it('reveals a session under the agent', () => {
    expect(revealPath(graph(), 'session-1')).toEqual(new Set(['agent-1', 'session-1']));
  });

  it('reveals an interaction under its session', () => {
    expect(revealPath(graph(), 'inter-1')).toEqual(new Set(['agent-1', 'session-1', 'inter-1']));
  });

  it('reveals a top-level member by opening its interaction', () => {
    expect(revealPath(graph(), 'llm1')).toEqual(
      new Set(['agent-1', 'session-1', 'inter-1', 'llm1']),
    );
  });

  it('reveals a nested member by opening every containing ancestor', () => {
    expect(revealPath(graph(), 'llm-nested')).toEqual(
      new Set(['agent-1', 'session-1', 'inter-1', 'toolA', 'llm-nested']),
    );
  });

  it('returns null for an unknown id', () => {
    expect(revealPath(graph(), 'nope')).toBeNull();
  });
});
