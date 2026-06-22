import { allSpansFlat } from '../canonical/enrich/id-utils.ts';
import { parseEntries } from '../canonical/native/parse.ts';
import type {
  ClassifiedInput,
  LogEntry,
  OtlpAttribute,
  SessionInputs,
  TempoTrace,
  UploadedFile,
} from '../types.ts';

function dirOf(file: UploadedFile): string {
  const p = file.path ?? file.name;
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '';
}

function readStringAttr(attrs: readonly OtlpAttribute[], key: string): string | null {
  const attr = attrs.find((a) => a.key === key);
  if (attr == null) return null;
  return 'stringValue' in attr.value ? attr.value.stringValue : null;
}

function sessionIdFromTrace(content: string): string | null {
  const trace = JSON.parse(content) as TempoTrace;
  for (const span of allSpansFlat(trace)) {
    const value = readStringAttr(span.attributes, 'session.id');
    if (value != null) return value;
  }
  return null;
}

function sessionIdFromLog(content: string): string | null {
  const logs = JSON.parse(content) as LogEntry[];
  return logs.find((l) => l.session_id != null)?.session_id ?? null;
}

function sessionIdFromNative(content: string): string | null {
  return parseEntries(content).sessionId || null;
}

// Why: traces always carry `session.id`; logs do not always. This maps each
// directory to the session id of the traces it contains, so a log with no
// `session_id` can still attach to its session by directory (the upload layout).
function mapDirsToSessions(classified: readonly ClassifiedInput[]): Map<string, string> {
  const dirToSession = new Map<string, string>();
  for (const input of classified.filter((i) => i.type === 'otel-trace')) {
    const sessionId = sessionIdFromTrace(input.file.content);
    if (sessionId != null) dirToSession.set(dirOf(input.file), sessionId);
  }
  return dirToSession;
}

function sessionIdOf(input: ClassifiedInput, dirToSession: Map<string, string>): string | null {
  switch (input.type) {
    case 'native':
      return sessionIdFromNative(input.file.content);
    case 'otel-trace':
      return sessionIdFromTrace(input.file.content);
    case 'otel-log':
      return sessionIdFromLog(input.file.content) ?? dirToSession.get(dirOf(input.file)) ?? null;
    case 'unsupported':
      return null;
  }
}

// Why: a session is assumed wholly OTEL or wholly native; the kind is derived
// from whether any input in the group is native. Inputs with no resolvable
// session id (unsupported, or empty/malformed) are dropped here.
export function routeToSessions(classified: readonly ClassifiedInput[]): SessionInputs[] {
  const dirToSession = mapDirsToSessions(classified);

  const bySession = new Map<string, ClassifiedInput[]>();
  for (const input of classified) {
    const sessionId = sessionIdOf(input, dirToSession);
    if (sessionId == null) continue;
    const group = bySession.get(sessionId) ?? [];
    group.push(input);
    bySession.set(sessionId, group);
  }

  return [...bySession].map(([sessionId, inputs]) => ({
    sessionId,
    kind: inputs.some((i) => i.type === 'native') ? 'native' : 'otel',
    inputs,
  }));
}
