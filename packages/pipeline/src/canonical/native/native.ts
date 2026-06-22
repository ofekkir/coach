import type { TempoTrace } from '../../types.ts';

import { traceB64 } from './helpers.ts';
import { buildInteractionSpan } from './interaction.ts';
import { buildRequestGroups, buildToolResultUserIndex, parseEntries } from './parse.ts';
import { buildSpansForRequest } from './spans.ts';
import type { NativeEntry } from './types.ts';

function isRealUserPrompt(e: NativeEntry): e is NativeEntry & { uuid: string; timestamp: string } {
  const content = e.message?.content;
  return (
    e.type === 'user' &&
    !e.isMeta &&
    typeof content === 'string' &&
    !content.startsWith('<') &&
    typeof e.uuid === 'string' &&
    typeof e.timestamp === 'string'
  );
}

function sliceEntriesForInteraction(
  entries: NativeEntry[],
  startTs: string,
  nextStartTs: string | undefined,
): NativeEntry[] {
  return entries.filter((e) => {
    if (!e.timestamp) return false;
    if (e.timestamp < startTs) return false;
    if (nextStartTs != null && e.timestamp >= nextStartTs) return false;
    return true;
  });
}

function firstTimestamp(group: NativeEntry[]): string {
  return group.find((e) => e.timestamp)?.timestamp ?? '';
}

function isGroupInInteraction(
  group: NativeEntry[],
  startTs: string,
  nextStartTs: string | undefined,
): boolean {
  const firstTs = group.find((e) => e.timestamp)?.timestamp;
  if (firstTs == null) return false;
  if (firstTs < startTs) return false;
  if (nextStartTs != null && firstTs >= nextStartTs) return false;
  return true;
}

export function nativeSessionToTrace(jsonl: string): TempoTrace {
  const { sessionId, entries } = parseEntries(jsonl);
  if (!sessionId || entries.length === 0) return { batches: [] };

  const tId = traceB64(sessionId);
  const byUuid = new Map<string, NativeEntry>(
    entries.flatMap((e) => (e.uuid != null ? [[e.uuid, e] as [string, NativeEntry]] : [])),
  );

  const prompts = entries.filter(isRealUserPrompt);
  if (prompts.length === 0) return { batches: [] };

  const requestGroups = buildRequestGroups(entries);
  const toolResultUser = buildToolResultUserIndex(entries);

  const spans = prompts.flatMap((prompt, seqIdx) => {
    const nextTs = prompts[seqIdx + 1]?.timestamp;
    const slice = sliceEntriesForInteraction(entries, prompt.timestamp, nextTs);
    const { span: interactionSpan, spanId: interactionSpanId } = buildInteractionSpan(
      tId,
      prompt,
      sessionId,
      slice,
      seqIdx,
    );

    const ownedGroups = [...requestGroups.entries()]
      .filter(([, group]) => isGroupInInteraction(group, prompt.timestamp, nextTs))
      .sort(([, a], [, b]) => (firstTimestamp(a) < firstTimestamp(b) ? -1 : 1));

    const ownedSpans = ownedGroups.flatMap(([requestId, group], idx) => {
      const prevGroup = idx > 0 ? (ownedGroups[idx - 1]?.[1] ?? null) : null;
      return buildSpansForRequest(
        tId,
        requestId,
        group,
        byUuid,
        toolResultUser,
        interactionSpanId,
        prevGroup,
      );
    });

    return [interactionSpan, ...ownedSpans];
  });

  return { batches: [{ scopeSpans: [{ spans }] }] };
}
