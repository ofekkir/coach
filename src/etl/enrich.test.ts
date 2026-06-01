import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import logsFixture from '../fixtures/otel/update-claude-config/logs.json';
import traceFixture from '../fixtures/otel/update-claude-config/trace.json';
import { enrichTrace } from './enrich.ts';
import { TempoTraceSchema } from './tempo.schema.ts';
import type { LogEntry, TempoTrace } from './types.ts';

function hex2b64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
}

function b64toHex(b64: string): string {
  return Buffer.from(b64, 'base64').toString('hex');
}

function getStringAttr(
  attrs: readonly { key: string; value: Record<string, unknown> }[],
  key: string,
): string | undefined {
  return attrs.find((a) => a.key === key)?.value.stringValue as string | undefined;
}

function allSpans(trace: TempoTrace) {
  return trace.batches.flatMap((b) => b.scopeSpans.flatMap((ss) => ss.spans));
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
              attributes: [{ key: 'span.type', value: { stringValue: 'interaction' } }],
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
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('enrichTrace', () => {
  it('produces a structurally valid OTLP trace', () => {
    const result = TempoTraceSchema.safeParse(enrichTrace(minimalTrace, []));
    expect(result.success).toBe(true);
  });

  it('real fixture enriches to a valid OTLP trace', () => {
    const result = TempoTraceSchema.safeParse(enrichTrace(traceFixture, logsFixture));
    expect(result.success).toBe(true);
  });

  it('preserves existing span count and adds hook spans', () => {
    const logs: LogEntry[] = [
      {
        timestamp_ns: 1100000000,
        event_sequence: '1',
        span_id: PARENT_HEX,
        event_name: 'hook_execution_start',
        hook_name: 'UserPromptSubmit',
      },
      {
        timestamp_ns: 1200000000,
        event_sequence: '2',
        span_id: PARENT_HEX,
        event_name: 'hook_execution_complete',
        hook_name: 'UserPromptSubmit',
      },
    ];
    const enriched = enrichTrace(minimalTrace, logs);
    const spans = allSpans(enriched);
    expect(spans.length).toBe(3); // 2 original + 1 hook
    expect(spans.some((s) => getStringAttr(s.attributes, 'span.type') === 'hook')).toBe(true);
  });

  it('adds query_source attribute to llm_request span from api_request log', () => {
    const logs: LogEntry[] = [
      {
        timestamp_ns: 1600000000,
        event_sequence: '1',
        span_id: PARENT_HEX,
        event_name: 'api_request',
        query_source: 'repl_main_thread',
      },
    ];
    const enriched = enrichTrace(minimalTrace, logs);
    const child = allSpans(enriched).find((s) => s.spanId === hex2b64(CHILD_HEX));
    expect(child).toBeDefined();
    expect(getStringAttr(child?.attributes ?? [], 'query_source')).toBe('repl_main_thread');
  });

  it('adds cost_usd attribute to llm_request span', () => {
    const logs: LogEntry[] = [
      {
        timestamp_ns: 1600000000,
        event_sequence: '1',
        span_id: PARENT_HEX,
        event_name: 'api_request',
        query_source: 'repl_main_thread',
        cost_usd: '0.001234',
      },
    ];
    const enriched = enrichTrace(minimalTrace, logs);
    const child = allSpans(enriched).find((s) => s.spanId === hex2b64(CHILD_HEX));
    expect(child).toBeDefined();
    expect(getStringAttr(child?.attributes ?? [], 'cost_usd')).toBe('0.001234');
  });

  it('sets UserPromptSubmit hook parent to the interaction span', () => {
    const logs: LogEntry[] = [
      {
        timestamp_ns: 1100000000,
        event_sequence: '1',
        span_id: PARENT_HEX,
        event_name: 'hook_execution_start',
        hook_name: 'UserPromptSubmit',
      },
    ];
    const enriched = enrichTrace(minimalTrace, logs);
    const hookSpan = allSpans(enriched).find(
      (s) => getStringAttr(s.attributes, 'span.type') === 'hook',
    );
    expect(hookSpan?.parentSpanId).toBe(hex2b64(PARENT_HEX));
  });

  it('real fixture: llm_request spans gain query_source and cost_usd', () => {
    const enriched = enrichTrace(traceFixture, logsFixture);
    const llmSpans = allSpans(enriched).filter(
      (s) => getStringAttr(s.attributes, 'span.type') === 'llm_request',
    );
    const withSource = llmSpans.filter((s) => getStringAttr(s.attributes, 'query_source') != null);
    const withCost = llmSpans.filter((s) => getStringAttr(s.attributes, 'cost_usd') != null);
    expect(withSource.length).toBeGreaterThan(0);
    expect(withCost.length).toBeGreaterThan(0);
  });

  it('real fixture: hook spans are created with hook.name attribute', () => {
    const enriched = enrichTrace(traceFixture, logsFixture);
    const hookSpans = allSpans(enriched).filter(
      (s) => getStringAttr(s.attributes, 'span.type') === 'hook',
    );
    expect(hookSpans.length).toBeGreaterThan(0);
    expect(hookSpans.every((s) => getStringAttr(s.attributes, 'hook.name') != null)).toBe(true);
  });

  it('hook spans carry the traceId of the source trace', () => {
    const logs: LogEntry[] = [
      {
        timestamp_ns: 1100000000,
        event_sequence: '1',
        span_id: PARENT_HEX,
        event_name: 'hook_execution_start',
        hook_name: 'UserPromptSubmit',
      },
    ];
    const enriched = enrichTrace(minimalTrace, logs);
    const hookSpan = allSpans(enriched).find(
      (s) => getStringAttr(s.attributes, 'span.type') === 'hook',
    );
    expect(hookSpan?.traceId).toBe(hex2b64(TRACE_HEX));
  });

  it('real fixture: all hook span IDs are valid 8-byte base64', () => {
    const enriched = enrichTrace(traceFixture, logsFixture);
    const hookSpans = allSpans(enriched).filter(
      (s) => getStringAttr(s.attributes, 'span.type') === 'hook',
    );
    for (const s of hookSpans) {
      expect(b64toHex(s.spanId).length).toBe(16); // 8 bytes = 16 hex chars
    }
  });
});
