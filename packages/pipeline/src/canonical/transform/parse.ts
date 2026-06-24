import type { OtlpAttribute, TempoTrace } from '../../types.ts';
import { NS_PER_MS } from '../../types.ts';
import { b64toHex, SPAN_ID_PREFIX } from '../enrich/id-utils.ts';

export interface ParsedSpan {
  readonly id: string;
  readonly parentId: string | null;
  readonly startNs: string;
  readonly endNs: string;
  readonly durationMs: number;
  readonly spanType: string;
  readonly model: string | null;
  readonly toolName: string | null;
  readonly toolUseId: string | null;
  readonly userPrompt: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly sessionId: string | null;
  readonly userId: string | null;
  readonly querySource: string | null;
  readonly rawRequestBody: string | null;
  readonly rawResponseBody: string | null;
  readonly costUsd: string | null;
  readonly toolInputSummary: string | null;
  readonly hookName: string | null;
  readonly sequenceIndex: number | null;
  readonly cwd: string | null;
  readonly branch: string | null;
}

function getStringAttr(attrs: readonly OtlpAttribute[], key: string): string | null {
  const a = attrs.find((x) => x.key === key);
  if (!a) return null;
  return 'stringValue' in a.value ? a.value.stringValue : null;
}

function getIntAttr(attrs: readonly OtlpAttribute[], key: string): number | null {
  const a = attrs.find((x) => x.key === key);
  if (!a) return null;
  if ('intValue' in a.value) return parseInt(a.value.intValue, 10);
  if ('stringValue' in a.value) {
    const n = parseInt(a.value.stringValue, 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

export function parseSpans(trace: TempoTrace): ParsedSpan[] {
  const spans = trace.batches
    .flatMap((batch) => batch.scopeSpans.flatMap((ss) => ss.spans))
    .map((span) => {
      const startNsBig = BigInt(span.startTimeUnixNano);
      const endNsBig = BigInt(span.endTimeUnixNano);
      return {
        id: SPAN_ID_PREFIX + b64toHex(span.spanId),
        parentId: span.parentSpanId ? SPAN_ID_PREFIX + b64toHex(span.parentSpanId) : null,
        startNs: span.startTimeUnixNano,
        endNs: span.endTimeUnixNano,
        durationMs: Number(endNsBig - startNsBig) / Number(NS_PER_MS),
        spanType: getStringAttr(span.attributes, 'span.type') ?? span.name,
        model: getStringAttr(span.attributes, 'model'),
        toolName: getStringAttr(span.attributes, 'tool_name'),
        toolUseId:
          getStringAttr(span.attributes, 'tool_use_id') ??
          getStringAttr(span.attributes, 'gen_ai.tool.call.id'),
        userPrompt: getStringAttr(span.attributes, 'user_prompt'),
        inputTokens: getIntAttr(span.attributes, 'input_tokens'),
        outputTokens: getIntAttr(span.attributes, 'output_tokens'),
        cacheReadTokens: getIntAttr(span.attributes, 'cache_read_input_tokens') ?? 0,
        cacheCreationTokens: getIntAttr(span.attributes, 'cache_creation_input_tokens') ?? 0,
        sessionId: getStringAttr(span.attributes, 'session.id'),
        userId: getStringAttr(span.attributes, 'user.id'),
        querySource: getStringAttr(span.attributes, 'query_source'),
        rawRequestBody: getStringAttr(span.attributes, 'raw_request_body'),
        rawResponseBody: getStringAttr(span.attributes, 'raw_response_body'),
        costUsd: getStringAttr(span.attributes, 'cost_usd'),
        toolInputSummary: getStringAttr(span.attributes, 'tool_input'),
        hookName: getStringAttr(span.attributes, 'hook.name'),
        sequenceIndex: getIntAttr(span.attributes, 'interaction.sequence'),
        cwd: getStringAttr(span.attributes, 'cwd'),
        branch: getStringAttr(span.attributes, 'git.branch'),
      };
    });
  spans.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return spans;
}
