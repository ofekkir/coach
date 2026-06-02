import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import logsFixture from '../../../fixtures/otel/update-claude-config/logs.json';
import traceFixture from '../../../fixtures/otel/update-claude-config/trace.json';
import { enrichTrace } from '../enrich/enrich.ts';
import { transformTrace } from './transform.ts';
import type { TempoTrace } from '../types.ts';

function hex2b64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
}

const TRACE_HEX = '00000000000000000000000000000001';
const PARENT_HEX = '0000000000000001';
const CHILD_HEX = '0000000000000002';

const minimalTrace: TempoTrace = {
  batches: [
    {
      scopeSpans: [
        {
          spans: [
            {
              traceId: hex2b64(TRACE_HEX),
              spanId: hex2b64(PARENT_HEX),
              name: 'claude_code.interaction',
              startTimeUnixNano: '1000000000',
              endTimeUnixNano: '3000000000',
              attributes: [
                { key: 'span.type', value: { stringValue: 'interaction' } },
                { key: 'user_prompt', value: { stringValue: 'hello world' } },
              ],
            },
            {
              traceId: hex2b64(TRACE_HEX),
              spanId: hex2b64(CHILD_HEX),
              parentSpanId: hex2b64(PARENT_HEX),
              name: 'claude_code.llm_request',
              startTimeUnixNano: '1500000000',
              endTimeUnixNano: '2000000000',
              attributes: [
                { key: 'span.type', value: { stringValue: 'llm_request' } },
                { key: 'model', value: { stringValue: 'claude-sonnet-4-6' } },
                { key: 'input_tokens', value: { intValue: '100' } },
                { key: 'output_tokens', value: { intValue: '50' } },
                { key: 'query_source', value: { stringValue: 'repl_main_thread' } },
                {
                  key: 'raw_request_body',
                  value: {
                    stringValue: JSON.stringify({
                      messages: [{ role: 'user', content: 'Do the thing' }],
                    }),
                  },
                },
                {
                  key: 'raw_response_body',
                  value: {
                    stringValue: JSON.stringify({
                      content: [{ type: 'text', text: 'Done.' }],
                      stop_reason: 'end_turn',
                    }),
                  },
                },
                { key: 'cost_usd', value: { stringValue: '0.001234' } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('transformTrace', () => {
  it('produces one node per span', () => {
    const nodes = transformTrace(minimalTrace);
    expect(nodes).toHaveLength(2);
  });

  it('sets type and id', () => {
    const nodes = transformTrace(minimalTrace);
    expect(nodes.find((n) => n.id === `s${PARENT_HEX}`)?.type).toBe('interaction');
    expect(nodes.find((n) => n.id === `s${CHILD_HEX}`)?.type).toBe('llm_request');
  });

  it('sets parent from parentSpanId', () => {
    const nodes = transformTrace(minimalTrace);
    expect(nodes.find((n) => n.id === `s${CHILD_HEX}`)?.parent).toBe(`s${PARENT_HEX}`);
  });

  it('computes duration_ms from span timestamps', () => {
    const nodes = transformTrace(minimalTrace);
    // (2000000000 - 1500000000) ns = 500ms
    expect(nodes.find((n) => n.id === `s${CHILD_HEX}`)?.duration_ms).toBeCloseTo(500);
  });

  it('maps interaction user_prompt to node.prompt', () => {
    const nodes = transformTrace(minimalTrace);
    expect(nodes.find((n) => n.id === `s${PARENT_HEX}`)?.prompt).toBe('hello world');
  });

  it('maps llm_request enriched attributes to node fields', () => {
    const nodes = transformTrace(minimalTrace);
    const child = nodes.find((n) => n.id === `s${CHILD_HEX}`);
    expect(child?.model).toBe('claude-sonnet-4-6');
    expect(child?.source).toBe('repl_main_thread');
    expect(child?.request).toBe('Do the thing');
    expect(child?.response).toBe('Done.');
    expect(child?.tokens_in).toBe(100);
    expect(child?.tokens_out).toBe(50);
    expect(child?.cost_usd).toBeCloseTo(0.001234);
  });

  it('smoke test: enrich then transform real fixture produces nodes', () => {
    const enriched = enrichTrace(traceFixture, logsFixture);
    const nodes = transformTrace(enriched);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.some((n) => n.type === 'interaction')).toBe(true);
    expect(nodes.some((n) => n.type === 'llm_request')).toBe(true);
    expect(nodes.some((n) => n.type === 'hook')).toBe(true);
    const llm = nodes.find((n) => n.type === 'llm_request' && n.source != null);
    expect(llm?.model).toBeDefined();
    expect(llm?.cost_usd).toBeDefined();
    expect(llm?.tokens_in).toBeDefined();
  });
});
