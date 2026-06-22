type MessageContent = string | { type: string; text?: string }[];

interface ReqBody {
  system?: MessageContent;
  messages?: { role: string; content: MessageContent }[];
}

interface ResBody {
  content?: { type: string; text?: string; thinking?: string; name?: string }[];
  stop_reason?: string;
}

function tryLoad(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const CLOSING: Record<string, string> = { '[': ']', '{': '}' };

function trackBracket(ch: string, stack: string[]): void {
  if (ch === '[' || ch === '{') {
    stack.push(ch);
    return;
  }
  if (ch === ']' && stack.at(-1) === '[') {
    stack.pop();
    return;
  }
  if (ch === '}' && stack.at(-1) === '{') {
    stack.pop();
  }
}

function repairTruncated(text: string): string {
  const stack: string[] = [];
  let inStr = false;
  let escape = false;
  for (const ch of text) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    trackBracket(ch, stack);
  }
  let result = text.trimEnd().replace(/,$/, '');
  if (inStr) result += '"';
  result += stack.reduceRight((acc, bracket) => acc + (CLOSING[bracket] ?? ''), '');
  return result;
}

function peel(obj: unknown): unknown {
  if (typeof obj !== 'string') return obj;
  return tryLoad(obj) ?? tryLoad(repairTruncated(obj)) ?? obj;
}

export function decodeRawBody(raw: string): unknown {
  const trimmed = raw.trimStart();
  const truncAt = trimmed.indexOf('[TRUNCATED');
  const text = truncAt !== -1 ? trimmed.slice(0, truncAt).trimEnd() : trimmed.trimEnd();

  const direct = tryLoad(text);
  if (direct !== undefined) return peel(direct);

  const asString = tryLoad('"' + text + '"');
  if (asString !== undefined) return peel(asString);

  const repaired = tryLoad(repairTruncated(text));
  if (repaired !== undefined) return peel(repaired);

  const repairedAsString = tryLoad('"' + text + '"');
  if (typeof repairedAsString === 'string') {
    const inner = tryLoad(repairTruncated(repairedAsString));
    if (inner !== undefined) return inner;
  }

  return null;
}

import type { RequestMessage, ResponseMessage } from '../../types.ts';

export function extractRequestMessages(bodyJson: string, repair: boolean): RequestMessage[] | null {
  const decoded = repair ? decodeRawBody(bodyJson) : tryLoad(bodyJson);
  if (decoded === null || decoded === undefined || typeof decoded !== 'object') return null;
  const body = decoded as ReqBody;
  const messages = body.messages;
  if (!Array.isArray(messages)) return null;
  if (body.system == null) return messages;
  return [{ role: 'system', content: body.system }, ...messages];
}

export function extractResponseMessages(bodyJson: string): ResponseMessage[] | null {
  const decoded = tryLoad(bodyJson);
  if (decoded === null || decoded === undefined || typeof decoded !== 'object') return null;
  const content = (decoded as ResBody).content;
  if (!Array.isArray(content)) return null;
  return content;
}

export function extractStopReason(bodyJson: string): string | null {
  try {
    const parsed = JSON.parse(bodyJson) as ResBody;
    return parsed.stop_reason ?? null;
  } catch {
    return null;
  }
}
