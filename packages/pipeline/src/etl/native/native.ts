import type { TempoTrace } from '../types.ts';
import { traceB64 } from './helpers.ts';
import { buildInteractionSpan } from './interaction.ts';
import { buildRequestGroups, buildToolResultUserIndex, parseEntries } from './parse.ts';
import { buildSpansForRequest } from './spans.ts';
import type { NativeEntry } from './types.ts';

export function nativeSessionToTrace(jsonl: string): TempoTrace {
  const { sessionId, entries } = parseEntries(jsonl);

  if (!sessionId || entries.length === 0) return { batches: [] };

  const tId = traceB64(sessionId);
  const byUuid = new Map<string, NativeEntry>(
    entries.flatMap((e) => (e.uuid != null ? [[e.uuid, e] as [string, NativeEntry]] : [])),
  );

  const humanUser = entries.find(
    (e) => e.type === 'user' && !e.isMeta && typeof e.message?.content === 'string',
  );
  if (!humanUser?.uuid || !humanUser.timestamp) return { batches: [] };

  const { span: interactionSpan, spanId: interactionSpanId } = buildInteractionSpan(
    tId,
    humanUser as NativeEntry & { uuid: string; timestamp: string },
    sessionId,
    entries,
  );

  const requestGroups = buildRequestGroups(entries);
  const toolResultUser = buildToolResultUserIndex(entries);

  const requestSpans = [...requestGroups.entries()].flatMap(([requestId, group]) =>
    buildSpansForRequest(tId, requestId, group, byUuid, toolResultUser, interactionSpanId),
  );

  return { batches: [{ scopeSpans: [{ spans: [interactionSpan, ...requestSpans] }] }] };
}
