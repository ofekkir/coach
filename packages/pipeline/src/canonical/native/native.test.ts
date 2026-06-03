import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addSessionNode } from '../../aggregate/aggregate.ts';
import { TempoTraceSchema } from '../tempo.schema.ts';
import type { CanonicalNode } from '../../types.ts';
import { transformTrace } from '../transform/transform.ts';
import { nativeSessionToTrace } from './native.ts';

function countLlmsByParent(llms: CanonicalNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of llms) {
    const key = n.parent ?? '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const FIXTURE_JSONL = readFileSync(
  join(import.meta.dirname, '../../../fixtures/native-claude/fetch-website/session.jsonl'),
  'utf8',
);

const SESSION_ID = 'ad41a13e-d973-44b4-9297-f6c225121826';

const MULTI_TURN_JSONL = readFileSync(
  join(import.meta.dirname, '../../../fixtures/native-claude/multi-turn/session.jsonl'),
  'utf8',
);

const MULTI_TURN_SESSION_ID = 'adef15c8-c761-4850-bfff-180b36ed1cd2';

describe('nativeSessionToTrace', () => {
  it('produces a TempoTrace that passes schema validation', () => {
    const trace = nativeSessionToTrace(FIXTURE_JSONL);
    expect(() => TempoTraceSchema.parse(trace)).not.toThrow();
  });

  it('transformTrace yields 1 interaction, 2 tools, 3 llm_requests', () => {
    const nodes = transformTrace(nativeSessionToTrace(FIXTURE_JSONL));

    const interactions = nodes.filter((n) => n.type === 'interaction');
    expect(interactions).toHaveLength(1);
    expect(interactions[0]?.prompt).toBe('fetch ynet.co.il');
    expect(interactions[0]?.session_id).toBe(SESSION_ID);

    const tools = nodes.filter((n) => n.type === 'tool');
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(['ToolSearch', 'WebFetch']);

    expect(nodes.filter((n) => n.type === 'llm_request')).toHaveLength(3);
  });

  it('llm_request nodes carry model, tokens, and stop_reason', () => {
    const nodes = transformTrace(nativeSessionToTrace(FIXTURE_JSONL));
    const llmNodes = nodes.filter((n) => n.type === 'llm_request');

    for (const n of llmNodes) {
      expect(n.model).toBe('claude-sonnet-4-6');
      expect(n.tokens_in).toBeGreaterThan(0);
      expect(n.tokens_out).toBeGreaterThan(0);
    }

    const endTurnNodes = llmNodes.filter((n) => n.stop_reason === 'end_turn');
    expect(endTurnNodes).toHaveLength(1);
  });

  it('addSessionNode produces a session node with the correct session_id', () => {
    const nodes = addSessionNode(transformTrace(nativeSessionToTrace(FIXTURE_JSONL)));
    const sessionNode = nodes.find((n) => n.type === 'session');
    expect(sessionNode).toBeDefined();
    expect(sessionNode?.session_id).toBe(SESSION_ID);

    const interaction = nodes.find((n) => n.type === 'interaction');
    expect(interaction?.parent).toBe(`session-${SESSION_ID}`);
  });

  it('empty / whitespace input returns a valid empty TempoTrace without throwing', () => {
    for (const input of ['', '   ', '\n\n\n']) {
      const trace = nativeSessionToTrace(input);
      expect(trace.batches).toBeDefined();
      expect(() => TempoTraceSchema.parse(trace)).not.toThrow();
    }
  });
});

describe('nativeSessionToTrace — multi-turn fixture', () => {
  it('produces a TempoTrace that passes schema validation', () => {
    const trace = nativeSessionToTrace(MULTI_TURN_JSONL);
    expect(() => TempoTraceSchema.parse(trace)).not.toThrow();
  });

  it('emits one interaction per user prompt (3 interactions)', () => {
    const nodes = transformTrace(nativeSessionToTrace(MULTI_TURN_JSONL));
    const interactions = nodes.filter((n) => n.type === 'interaction');
    expect(interactions).toHaveLength(3);
    expect(interactions[0]?.prompt).toBe('fetch ynet.co.il');
    expect(interactions[1]?.prompt).toBe('translated to hebrew the second one');
    expect(interactions[2]?.prompt).toBe('translate to english and convert it to a joke');
  });

  it('each interaction carries the correct sequence index', () => {
    const nodes = transformTrace(nativeSessionToTrace(MULTI_TURN_JSONL));
    const interactions = nodes.filter((n) => n.type === 'interaction');
    expect(interactions[0]?.sequence).toBe(0);
    expect(interactions[1]?.sequence).toBe(1);
    expect(interactions[2]?.sequence).toBe(2);
  });

  it('llm_requests are partitioned correctly across interactions', () => {
    const nodes = transformTrace(nativeSessionToTrace(MULTI_TURN_JSONL));
    const llms = nodes.filter((n) => n.type === 'llm_request');
    expect(llms).toHaveLength(5);

    const interactions = nodes.filter((n) => n.type === 'interaction');
    const counts = countLlmsByParent(llms);
    expect(counts.get(interactions[0]?.id ?? '')).toBe(3);
    expect(counts.get(interactions[1]?.id ?? '')).toBe(1);
    expect(counts.get(interactions[2]?.id ?? '')).toBe(1);
  });

  it('all sessions carry the same session_id', () => {
    const nodes = addSessionNode(transformTrace(nativeSessionToTrace(MULTI_TURN_JSONL)));
    const session = nodes.find((n) => n.type === 'session');
    expect(session?.session_id).toBe(MULTI_TURN_SESSION_ID);
    const interactions = nodes.filter((n) => n.type === 'interaction');
    for (const i of interactions) {
      expect(i.session_id).toBe(MULTI_TURN_SESSION_ID);
    }
  });
});
