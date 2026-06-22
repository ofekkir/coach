import { PSEUDO_USER_ID } from '../../types.ts';
import type { OtlpAttribute, OtlpSpan } from '../../types.ts';

import { clampEnd, intAttr, isoToNano, spanB64, strAttr } from './helpers.ts';
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
  seqIdx: number,
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
        strAttr('user.id', PSEUDO_USER_ID),
        intAttr('interaction.sequence', seqIdx),
        ...sessionContextAttrs(humanUser),
      ],
    },
  };
}

// Why: native entries carry cwd/git branch per-record; emitted only when present
// so OTEL traces, which lack them, stay NULL rather than empty strings.
function sessionContextAttrs(entry: NativeEntry): OtlpAttribute[] {
  const attrs: OtlpAttribute[] = [];
  if (entry.cwd != null) attrs.push(strAttr('cwd', entry.cwd));
  if (entry.gitBranch != null) attrs.push(strAttr('git.branch', entry.gitBranch));
  return attrs;
}
