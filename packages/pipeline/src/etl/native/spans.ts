import type { OtlpAttribute, OtlpSpan } from '../types.ts';
import { clampEnd, isoToNano, intAttr, spanB64, strAttr, summarizeInput } from './helpers.ts';
import type { ContentBlock, LlmSpanMeta, NativeEntry } from './types.ts';
import {
  buildRequestGroups,
  buildToolResultUserIndex,
  collectContentBlocks,
  findEntryWithBlock,
  findTriggeringUser,
} from './parse.ts';

function extractLlmGroupBounds(group: NativeEntry[]): {
  first: NativeEntry & { timestamp: string };
  last: NativeEntry & { timestamp: string };
} | null {
  const first = group[0];
  const last = group[group.length - 1];
  if (!first?.timestamp || !last?.timestamp) return null;
  return {
    first: first as NativeEntry & { timestamp: string },
    last: last as NativeEntry & { timestamp: string },
  };
}

function extractFirstMessageFields(msg: NativeEntry['message']): {
  model: string;
  inputTokens: number;
  outputTokens: number;
} {
  return {
    model: msg?.model ?? '',
    inputTokens: msg?.usage?.input_tokens ?? 0,
    outputTokens: msg?.usage?.output_tokens ?? 0,
  };
}

function extractTokenUsage(
  first: NativeEntry,
  last: NativeEntry,
): { model: string; stopReason: string; inputTokens: number; outputTokens: number } {
  const fromFirst = extractFirstMessageFields(first.message);
  return { ...fromFirst, stopReason: last.message?.stop_reason ?? '' };
}

function extractLlmSpanMeta(group: NativeEntry[]): LlmSpanMeta | null {
  const bounds = extractLlmGroupBounds(group);
  if (bounds == null) return null;
  const { first, last } = bounds;
  const spanStart = isoToNano(first.timestamp);
  const usage = extractTokenUsage(first, last);
  return {
    ...usage,
    spanStart,
    spanEnd: clampEnd(spanStart, isoToNano(last.timestamp)),
  };
}

function buildLlmSpan(
  tId: string,
  requestId: string,
  group: NativeEntry[],
  allBlocks: ContentBlock[],
  interactionSpanId: string,
  trigUser: NativeEntry | null,
): OtlpSpan | null {
  const meta = extractLlmSpanMeta(group);
  if (meta == null) return null;

  const rawRequestBody = JSON.stringify({
    messages: [{ role: 'user', content: trigUser?.message?.content ?? null }],
  });
  const rawResponseBody = JSON.stringify({ content: allBlocks, stop_reason: meta.stopReason });

  return {
    traceId: tId,
    spanId: spanB64('llm_request', requestId),
    parentSpanId: interactionSpanId,
    name: 'claude_code.llm_request',
    startTimeUnixNano: meta.spanStart,
    endTimeUnixNano: meta.spanEnd,
    attributes: [
      strAttr('span.type', 'llm_request'),
      strAttr('model', meta.model),
      intAttr('input_tokens', meta.inputTokens),
      intAttr('output_tokens', meta.outputTokens),
      strAttr('stop_reason', meta.stopReason),
      strAttr('request_id', requestId),
      strAttr('raw_request_body', rawRequestBody),
      strAttr('raw_response_body', rawResponseBody),
    ],
  };
}

function buildToolSpan(
  tId: string,
  block: ContentBlock,
  group: NativeEntry[],
  toolResultUser: Map<string, NativeEntry>,
  interactionSpanId: string,
): OtlpSpan | null {
  if (block.type !== 'tool_use' || typeof block.id !== 'string') return null;

  const entryWithTool = findEntryWithBlock(group, block.id);
  if (!entryWithTool?.timestamp) return null;

  const toolStart = isoToNano(entryWithTool.timestamp);
  const resultEntry = toolResultUser.get(block.id);
  const toolEnd = clampEnd(
    toolStart,
    resultEntry?.timestamp ? isoToNano(resultEntry.timestamp) : toolStart,
  );

  const summary = summarizeInput(block.input);
  const toolAttrs: OtlpAttribute[] = [
    strAttr('span.type', 'tool'),
    strAttr('tool_name', block.name ?? 'unknown'),
  ];
  if (summary != null) toolAttrs.push(strAttr('tool_input_summary', summary));

  return {
    traceId: tId,
    spanId: spanB64('tool', block.id),
    parentSpanId: interactionSpanId,
    name: 'claude_code.tool',
    startTimeUnixNano: toolStart,
    endTimeUnixNano: toolEnd,
    attributes: toolAttrs,
  };
}

export function buildSpansForRequest(
  tId: string,
  requestId: string,
  group: NativeEntry[],
  byUuid: Map<string, NativeEntry>,
  toolResultUser: Map<string, NativeEntry>,
  interactionSpanId: string,
): OtlpSpan[] {
  group.sort((a, b) => ((a.timestamp ?? '') < (b.timestamp ?? '') ? -1 : 1));
  const first = group[0];
  if (!first) return [];

  const allBlocks = collectContentBlocks(group);
  const trigUser = findTriggeringUser(first, byUuid);

  const llmSpan = buildLlmSpan(tId, requestId, group, allBlocks, interactionSpanId, trigUser);
  if (!llmSpan) return [];

  const toolSpans = allBlocks.flatMap((block) => {
    const span = buildToolSpan(tId, block, group, toolResultUser, interactionSpanId);
    return span != null ? [span] : [];
  });

  return [llmSpan, ...toolSpans];
}

export { buildRequestGroups, buildToolResultUserIndex };
