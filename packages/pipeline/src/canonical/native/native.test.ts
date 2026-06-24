import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { aggregate } from '../../aggregate/aggregate.ts';
import type { CanonicalNode, ToolNode } from '../../types.ts';
import { sessionEntityId } from '../../types.ts';
import { TempoTraceSchema } from '../tempo.schema.ts';
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

const REFACTOR_JSONL = readFileSync(
  join(import.meta.dirname, '../../../fixtures/native-claude/refactor-code/session.jsonl'),
  'utf8',
);

function toolResultText(b: unknown): string | null {
  if (typeof b !== 'object' || b === null) return null;
  const block = b as { type?: unknown; content?: unknown };
  if (block.type !== 'tool_result') return null;
  return typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
}

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

    const tools = nodes.filter((n): n is ToolNode => n.type === 'tool');
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

  it('extracts prompt-cache token fields from native usage', () => {
    const nodes = transformTrace(nativeSessionToTrace(FIXTURE_JSONL));
    const llmNodes = nodes.filter((n) => n.type === 'llm_request');

    for (const n of llmNodes) {
      expect(n.cache_read_tokens).toBeGreaterThanOrEqual(0);
      expect(n.cache_creation_tokens).toBeGreaterThanOrEqual(0);
    }
    // The fetch-website session is heavily cached: at least one request creates and
    // at least one reads from the prompt cache.
    expect(llmNodes.some((n) => n.cache_creation_tokens > 0)).toBe(true);
    expect(llmNodes.some((n) => n.cache_read_tokens > 0)).toBe(true);
  });

  it('defaults cache token fields to 0 when native usage omits them', () => {
    const userEntry = {
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      sessionId: 's-test',
      timestamp: '2024-01-01T00:00:00.000Z',
      message: { role: 'user', content: 'hi there' },
    };
    const assistantEntry = {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      sessionId: 's-test',
      timestamp: '2024-01-01T00:00:01.000Z',
      requestId: 'req-1',
      message: {
        id: 'm1',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'hi' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    };
    const jsonl = [userEntry, assistantEntry].map((e) => JSON.stringify(e)).join('\n');
    const nodes = transformTrace(nativeSessionToTrace(jsonl));
    const llm = nodes.find((n) => n.type === 'llm_request');
    expect(llm?.cache_read_tokens).toBe(0);
    expect(llm?.cache_creation_tokens).toBe(0);
  });

  it('aggregate produces a Session entity with the correct session id', () => {
    const nodes = transformTrace(nativeSessionToTrace(FIXTURE_JSONL));
    const { sessions } = aggregate([nodes]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(SESSION_ID);
    expect(sessions[0]?.id).toBe(sessionEntityId(SESSION_ID));

    // The interaction is a root node carrying the session FK, not re-parented.
    const interaction = nodes.find((n) => n.type === 'interaction');
    expect(interaction?.parent).toBeUndefined();
    expect(interaction?.sessionId).toBe(sessionEntityId(SESSION_ID));
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

  it('all interactions roll up under one Session entity', () => {
    const nodes = transformTrace(nativeSessionToTrace(MULTI_TURN_JSONL));
    const { sessions } = aggregate([nodes]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(MULTI_TURN_SESSION_ID);
    const interactions = nodes.filter((n) => n.type === 'interaction');
    for (const i of interactions) {
      expect(i.session_id).toBe(MULTI_TURN_SESSION_ID);
    }
  });
});

describe('nativeSessionToTrace — parallel tool_results feed the next inference', () => {
  it('reconstructs every sibling tool_result of the previous inference into one request', () => {
    const nodes = transformTrace(nativeSessionToTrace(REFACTOR_JSONL));
    const llms = nodes.filter((n) => n.type === 'llm_request');

    const withBothResults = llms.find((n) => {
      const firstMsg = n.request_messages?.[0]?.content;
      if (!Array.isArray(firstMsg)) return false;
      const texts = firstMsg.map(toolResultText).filter((t): t is string => t !== null);
      return (
        texts.length >= 2 &&
        texts.some((t) => t.includes('.claire')) &&
        texts.some((t) => t.includes('"name": "coach"'))
      );
    });

    expect(withBothResults).toBeDefined();
  });
});
