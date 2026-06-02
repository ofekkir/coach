import type { OtlpSpan } from '../types.ts';
import { clampEnd, isoToNano, spanB64, strAttr } from './helpers.ts';
import type { NativeEntry } from './types.ts';

function resolveInteractionEndNs(entries: NativeEntry[], interactionStartNs: string): string {
  const turnDuration = entries.find((e) => e.type === 'system' && e.subtype === 'turn_duration');
  const lastAssistant = entries.findLast((e) => e.type === 'assistant' && e.timestamp);
  const rawEnd = turnDuration?.timestamp
    ? isoToNano(turnDuration.timestamp)
    : lastAssistant?.timestamp
      ? isoToNano(lastAssistant.timestamp)
      : interactionStartNs;
  return clampEnd(interactionStartNs, rawEnd);
}

export function buildInteractionSpan(
  tId: string,
  humanUser: NativeEntry & { uuid: string; timestamp: string },
  sessionId: string,
  entries: NativeEntry[],
): { span: OtlpSpan; spanId: string } {
  const humanContent = humanUser.message?.content;
  const userPrompt = typeof humanContent === 'string' ? humanContent : '';
  const interactionStartNs = isoToNano(humanUser.timestamp);
  const interactionEndNs = resolveInteractionEndNs(entries, interactionStartNs);
  const spanId = spanB64('interaction', humanUser.uuid);
  return {
    spanId,
    span: {
      traceId: tId,
      spanId,
      name: 'claude_code.interaction',
      startTimeUnixNano: interactionStartNs,
      endTimeUnixNano: interactionEndNs,
      attributes: [
        strAttr('span.type', 'interaction'),
        strAttr('user_prompt', userPrompt),
        strAttr('session.id', sessionId),
      ],
    },
  };
}
