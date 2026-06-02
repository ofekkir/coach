import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addSessionNode } from '../aggregate.ts';
import { TempoTraceSchema } from '../tempo.schema.ts';
import { transformTrace } from '../transform/transform.ts';
import { nativeSessionToTrace } from './native.ts';

const FIXTURE_JSONL = readFileSync(
  join(import.meta.dirname, '../../../fixtures/native-claude/fetch-website/session.jsonl'),
  'utf8',
);

const SESSION_ID = 'ad41a13e-d973-44b4-9297-f6c225121826';

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
