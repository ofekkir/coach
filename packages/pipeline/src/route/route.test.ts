import { describe, expect, it } from 'vitest';

import type { ClassifiedInput } from '../types.ts';

import { routeToSessions } from './route.ts';

function input(
  name: string,
  type: ClassifiedInput['type'],
  content: string,
  path?: string,
): ClassifiedInput {
  return { type, file: { name, content, ...(path != null ? { path } : {}) } };
}

const logsNoSessionId = JSON.stringify([{ event_name: 'user_prompt' }]);

const nativeJsonl = JSON.stringify({ sessionId: 's-native', type: 'user' });
const traceJson = JSON.stringify({
  batches: [
    {
      scopeSpans: [
        { spans: [{ attributes: [{ key: 'session.id', value: { stringValue: 's-otel' } }] }] },
      ],
    },
  ],
});
const logsJson = JSON.stringify([{ session_id: 's-otel', event_name: 'user_prompt' }]);

describe('routeToSessions', () => {
  it('groups OTEL logs and traces under their shared session id', () => {
    const sessions = routeToSessions([
      input('trace.json', 'otel-trace', traceJson),
      input('logs.json', 'otel-log', logsJson),
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe('s-otel');
    expect(sessions[0]?.kind).toBe('otel');
    expect(sessions[0]?.inputs).toHaveLength(2);
  });

  it('attaches a log with no session_id to its session by directory', () => {
    const sessions = routeToSessions([
      input('trace.json', 'otel-trace', traceJson, 'proj/trace.json'),
      input('logs.json', 'otel-log', logsNoSessionId, 'proj/logs.json'),
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe('s-otel');
    expect(sessions[0]?.inputs).toHaveLength(2);
  });

  it('routes native and OTEL into separate sessions and drops unsupported', () => {
    const sessions = routeToSessions([
      input('session.jsonl', 'native', nativeJsonl),
      input('trace.json', 'otel-trace', traceJson),
      input('README.md', 'unsupported', 'noise'),
    ]);

    expect(sessions.map((s) => s.sessionId).sort()).toEqual(['s-native', 's-otel']);
    expect(sessions.find((s) => s.sessionId === 's-native')?.kind).toBe('native');
  });
});
