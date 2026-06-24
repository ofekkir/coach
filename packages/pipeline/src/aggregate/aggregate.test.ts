import { describe, expect, it } from 'vitest';

import type { CanonicalNode } from '../types.ts';

import { aggregate } from './aggregate.ts';

// A minimal interaction → tool → nested inference chain, so the parent closure has
// to climb two levels to reach the interaction root.
function chain(): CanonicalNode[] {
  const base = { sessionId: 'session-s', start_time_ns: '0', end_time_ns: '0', duration_ms: 0 };
  return [
    {
      id: 'i',
      type: 'interaction',
      session_id: 's',
      user_id: 'u',
      sequence: 0,
      prompt: 'hi',
      ...base,
    },
    { id: 't', type: 'tool', parent: 'i', name: 'Read', ...base },
    {
      id: 'sub',
      type: 'llm_request',
      parent: 't',
      model: 'm',
      tokens_in: 0,
      tokens_out: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      ...base,
    },
  ];
}

describe('aggregate', () => {
  it('stamps interactionId via the parent closure (root = the interaction node itself)', () => {
    const { nodes } = aggregate([chain()]);
    const byId = new Map(nodes.map((n) => [n.id, n.interactionId]));
    expect(byId.get('i')).toBe('i');
    expect(byId.get('t')).toBe('i');
    expect(byId.get('sub')).toBe('i');
  });
});
