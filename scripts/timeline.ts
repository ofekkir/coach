import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LogEntry, TempoTrace } from '../src/graph/mermaid.ts';

// ── Types (mirrors mermaid.ts internals) ─────────────────────────────────────

type OtlpValue =
  | { readonly stringValue: string }
  | { readonly boolValue: boolean }
  | { readonly intValue: string }
  | { readonly doubleValue: number }
  | { readonly arrayValue: { readonly values: readonly OtlpValue[] } };

interface OtlpAttribute {
  readonly key: string;
  readonly value: OtlpValue;
}

interface ParsedSpan {
  readonly spanIdHex: string;
  readonly parentIdHex: string | null;
  readonly startNs: bigint;
  readonly endNs: bigint;
  readonly spanType: string;
  readonly model: string | null;
  readonly requestId: string | null;
  readonly toolName: string | null;
}

interface HookNode {
  readonly hookName: string;
  readonly startNs: bigint;
  readonly sequence: number;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

function b64toHex(b64: string): string {
  return Buffer.from(b64, 'base64').toString('hex');
}

function getStringAttr(attrs: readonly OtlpAttribute[], key: string): string | null {
  const a = attrs.find((x) => x.key === key);
  if (!a) return null;
  const v = a.value;
  return 'stringValue' in v ? v.stringValue : null;
}

function parseSpans(trace: TempoTrace): ParsedSpan[] {
  const spans: ParsedSpan[] = [];
  for (const batch of trace.batches) {
    for (const ss of batch.scopeSpans) {
      for (const span of ss.spans) {
        spans.push({
          spanIdHex: b64toHex(span.spanId),
          parentIdHex: span.parentSpanId ? b64toHex(span.parentSpanId) : null,
          startNs: BigInt(span.startTimeUnixNano),
          endNs: BigInt(span.endTimeUnixNano),
          spanType: getStringAttr(span.attributes, 'span.type') ?? span.name,
          model: getStringAttr(span.attributes, 'model'),
          requestId: getStringAttr(span.attributes, 'request_id'),
          toolName: getStringAttr(span.attributes, 'tool_name'),
        });
      }
    }
  }
  spans.sort((a, b) => (a.startNs < b.startNs ? -1 : a.startNs > b.startNs ? 1 : 0));
  return spans;
}

// ── Attribution ───────────────────────────────────────────────────────────────

function narrowestContainingSpan(spans: readonly ParsedSpan[], ns: bigint): ParsedSpan | null {
  let best: ParsedSpan | null = null;
  let bestDuration = BigInt(-1);
  for (const span of spans) {
    if (ns >= span.startNs && ns <= span.endNs) {
      const duration = span.endNs - span.startNs;
      if (best === null || duration < bestDuration) {
        best = span;
        bestDuration = duration;
      }
    }
  }
  return best;
}

function attributeLogsToSpans(
  spans: readonly ParsedSpan[],
  logs: readonly LogEntry[],
): Map<string, LogEntry[]> {
  const requestIdIndex = new Map<string, string>();
  const childSpanIds = new Set<string>();
  for (const span of spans) {
    if (span.requestId !== null) requestIdIndex.set(span.requestId, span.spanIdHex);
    if (span.parentIdHex !== null) childSpanIds.add(span.spanIdHex);
  }

  const bySpan = new Map<string, LogEntry[]>();
  for (const log of logs) {
    let targetHex: string;
    if (log.request_id != null) {
      targetHex = requestIdIndex.get(log.request_id) ?? log.span_id;
    } else if (childSpanIds.has(log.span_id)) {
      targetHex = log.span_id;
    } else {
      const containing = narrowestContainingSpan(spans, BigInt(log.timestamp_ns));
      targetHex = containing !== null ? containing.spanIdHex : log.span_id;
    }
    const bucket = bySpan.get(targetHex);
    if (bucket !== undefined) {
      bucket.push(log);
    } else {
      bySpan.set(targetHex, [log]);
    }
  }

  for (const bucket of bySpan.values()) {
    bucket.sort((a, b) =>
      parseInt(a.event_sequence, 10) < parseInt(b.event_sequence, 10) ? -1 : 1,
    );
  }

  return bySpan;
}

function extractHookNodes(logs: readonly LogEntry[]): HookNode[] {
  return logs
    .filter((l) => l.event_name === 'hook_execution_start' && l.hook_name != null)
    .map((l) => ({
      hookName: l.hook_name ?? '',
      startNs: BigInt(l.timestamp_ns),
      sequence: parseInt(l.event_sequence, 10),
    }));
}

// ── Enrichment ────────────────────────────────────────────────────────────────

interface RequestBody {
  messages?: {
    role: string;
    content: string | { type: string; text?: string }[];
  }[];
}

interface ResponseBody {
  content?: { type: string; text?: string; thinking?: string; name?: string }[];
}

function firstTextFrom(content: string | { type: string; text?: string }[]): string | null {
  if (typeof content === 'string') return content;
  for (const block of content) {
    if (block.type === 'text' && block.text) return block.text;
  }
  return null;
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function regexExtractTextAfter(bodyJson: string, fromIndex: number): string | null {
  const slice = bodyJson.slice(fromIndex);
  // Match "text":"<value>" — closing quote optional to handle truncated bodies
  const m = /"text":"((?:[^"\\]|\\.)+)/.exec(slice);
  if (!m?.[1]) return null;
  return unescapeJsonString(m[1]);
}

function extractLastUserText(bodyJson: string): string | null {
  let parsed: RequestBody;
  try {
    parsed = JSON.parse(bodyJson) as RequestBody;
  } catch {
    // Regex fallback for truncated bodies: find the last "role":"user" then extract text
    let lastUserIdx = -1;
    const roleRe = /"role":"user"/g;
    let m: RegExpExecArray | null;
    while ((m = roleRe.exec(bodyJson)) !== null) lastUserIdx = m.index;
    if (lastUserIdx === -1) return null;
    return regexExtractTextAfter(bodyJson, lastUserIdx);
  }
  const messages = parsed.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    const text = firstTextFrom(msg.content);
    if (text) return text;
  }
  return null;
}

function extractRequestBodyPreview(bodyJson: string): string | null {
  let parsed: RequestBody;
  try {
    parsed = JSON.parse(bodyJson) as RequestBody;
  } catch {
    // Regex fallback for truncated bodies: find the first role then extract text
    const roleM = /"role":"([^"]+)"/.exec(bodyJson);
    if (!roleM) return null;
    const [, role] = roleM;
    const text = regexExtractTextAfter(bodyJson, roleM.index);
    if (!text || !role) return null;
    return `[${role}] ${text}`;
  }
  const first = parsed.messages?.[0];
  if (!first) return null;
  const text = firstTextFrom(first.content);
  if (!text) return null;
  return `[${first.role}] ${text}`;
}

function extractResponseBodyPreview(bodyJson: string): string | null {
  let parsed: ResponseBody;
  try {
    parsed = JSON.parse(bodyJson) as ResponseBody;
  } catch {
    return null;
  }
  const block = parsed.content?.[0];
  if (!block) return null;
  const text = block.text ?? block.thinking ?? (block.name ? `tool_use:${block.name}` : null);
  if (!text) return null;
  return `[${block.type}] ${text}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function spanRequestContent(span: ParsedSpan, logsBySpan: Map<string, LogEntry[]>): string | null {
  if (span.spanType !== 'llm_request') return null;
  const logs = logsBySpan.get(span.spanIdHex) ?? [];
  const bodyLog = logs.find((l) => l.event_name === 'api_request_body' && l.body != null);
  if (!bodyLog?.body) return null;
  const text = extractLastUserText(bodyLog.body);
  return text !== null ? truncate(text.trim().replace(/\s+/g, ' '), 200) : null;
}

// ── Timeline assembly ─────────────────────────────────────────────────────────

interface TimelineEntry {
  readonly primaryNs: bigint;
  readonly kind: 0 | 1 | 2; // 0 = span_start, 1 = log/hook, 2 = span_end
  readonly sequence: number;
  readonly text: string;
}

function buildParentToolNameIndex(spans: readonly ParsedSpan[]): Map<string, string> {
  const toolNameBySpanId = new Map<string, string>();
  for (const span of spans) {
    if (span.toolName !== null) toolNameBySpanId.set(span.spanIdHex, span.toolName);
  }
  const resolved = new Map<string, string>();
  for (const span of spans) {
    if (span.toolName !== null) {
      resolved.set(span.spanIdHex, span.toolName);
    } else if (span.parentIdHex !== null) {
      const parentToolName = toolNameBySpanId.get(span.parentIdHex);
      if (parentToolName !== undefined) resolved.set(span.spanIdHex, parentToolName);
    }
  }
  return resolved;
}

function spanBaseLabel(span: ParsedSpan, resolvedToolNames: Map<string, string>): string {
  const toolName = resolvedToolNames.get(span.spanIdHex) ?? null;
  if (toolName !== null) return `${span.spanType} (${toolName})`;
  if (span.model !== null) return `${span.spanType} (${span.model})`;
  return span.spanType;
}

function buildTimeline(
  spans: readonly ParsedSpan[],
  logsBySpan: Map<string, LogEntry[]>,
  hooks: readonly HookNode[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const resolvedToolNames = buildParentToolNameIndex(spans);

  for (const span of spans) {
    const base = spanBaseLabel(span, resolvedToolNames);
    const content = spanRequestContent(span, logsBySpan);
    const startText = content !== null ? `${base} - start | ${content}` : `${base} - start`;

    entries.push({ primaryNs: span.startNs, kind: 0, sequence: 0, text: startText });
    entries.push({ primaryNs: span.endNs, kind: 2, sequence: 0, text: `${base} - end` });

    for (const log of logsBySpan.get(span.spanIdHex) ?? []) {
      let suffix = '';
      if (log.event_name === 'api_request' && log.query_source != null) {
        suffix = ` | ${log.query_source}`;
      } else if (log.event_name === 'tool_decision' && log.tool_name != null) {
        suffix = ` | ${log.tool_name}`;
      } else if (log.event_name === 'api_request_body' && log.body != null) {
        const preview = extractRequestBodyPreview(log.body);
        if (preview !== null) suffix = ` | ${truncate(preview.trim().replace(/\s+/g, ' '), 100)}`;
      } else if (log.event_name === 'api_response_body' && log.body != null) {
        const preview = extractResponseBodyPreview(log.body);
        if (preview !== null) suffix = ` | ${truncate(preview.trim().replace(/\s+/g, ' '), 100)}`;
      } else if (log.event_name === 'user_prompt' && log.prompt != null) {
        suffix = ` | ${truncate(log.prompt.trim().replace(/\s+/g, ' '), 100)}`;
      }
      entries.push({
        primaryNs: BigInt(log.timestamp_ns),
        kind: 1,
        sequence: parseInt(log.event_sequence, 10),
        text: log.event_name + suffix,
      });
    }
  }

  for (const hook of hooks) {
    entries.push({
      primaryNs: hook.startNs,
      kind: 1,
      sequence: hook.sequence,
      text: `hook: ${hook.hookName}`,
    });
  }

  entries.sort((a, b) => {
    if (a.primaryNs < b.primaryNs) return -1;
    if (a.primaryNs > b.primaryNs) return 1;
    if (a.kind !== b.kind) return a.kind - b.kind;
    return a.sequence - b.sequence;
  });

  return entries;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const fixturesDir = join(import.meta.dirname, '..', 'src', 'fixtures');
const traceId = '787ceebc8510eea59c08cea073a1dd2';

const trace = JSON.parse(
  readFileSync(join(fixturesDir, `trace-${traceId}.json`), 'utf8'),
) as TempoTrace;

const rawLogs = JSON.parse(
  readFileSync(join(fixturesDir, `logs-${traceId}.json`), 'utf8'),
) as LogEntry[];

const logs = [...rawLogs].sort(
  (a, b) => parseInt(a.event_sequence, 10) - parseInt(b.event_sequence, 10),
);

const spans = parseSpans(trace);
const hooks = extractHookNodes(logs);
const nonHookLogs = logs.filter(
  (l) => l.event_name !== 'hook_execution_start' && l.event_name !== 'hook_execution_complete',
);
const logsBySpan = attributeLogsToSpans(spans, nonHookLogs);
const timeline = buildTimeline(spans, logsBySpan, hooks);

writeFileSync(
  'out.timeline',
  timeline.map((e) => `${e.kind === 1 ? 'L' : 'T'} | ${e.text}`).join('\n') + '\n',
);
console.log(`wrote out.timeline (${String(timeline.length)} entries)`);
