interface ReqBody {
  messages?: { role: string; content: string | { type: string; text?: string }[] }[];
}

interface ResBody {
  content?: { type: string; text?: string; thinking?: string; name?: string }[];
  stop_reason?: string;
}

// ── Raw body decoding (handles double-escaped / truncated JSON) ───────────────

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

// ── Request prompt extraction ─────────────────────────────────────────────────

function firstText(content: string | { type: string; text?: string }[]): string | null {
  if (typeof content === 'string') return content;
  for (const b of content) {
    if (b.type === 'text' && b.text) return b.text;
  }
  return null;
}

function unescape(s: string): string {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function lastUserTextFromParsed(messages: ReqBody['messages']): string | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    const text = firstText(msg.content);
    if (text) return text.trim();
  }
  return null;
}

function lastUserTextFromRaw(bodyJson: string): string | null {
  let lastIdx = -1;
  const re = /"role":"user"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyJson)) !== null) lastIdx = m.index;
  if (lastIdx === -1) return null;
  const tm = /"text":"((?:[^"\\]|\\.)+)/.exec(bodyJson.slice(lastIdx));
  if (!tm?.[1]) return null;
  return unescape(tm[1]);
}

export function extractRequestPrompt(bodyJson: string): string | null {
  const decoded = decodeRawBody(bodyJson);
  if (decoded !== null && typeof decoded === 'object') {
    return lastUserTextFromParsed((decoded as ReqBody).messages);
  }
  return lastUserTextFromRaw(bodyJson);
}

function extractResponseTextFromBlock(block: {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
}): string | null {
  if (block.type === 'text' && block.text) return block.text;
  if (block.type === 'tool_use' && block.name) return `tool_use: ${block.name}`;
  if (block.type === 'thinking' && block.thinking && block.thinking !== '<REDACTED>') {
    return block.thinking;
  }
  return null;
}

function firstBlockText(content: ResBody['content']): string | null {
  for (const block of content ?? []) {
    const text = extractResponseTextFromBlock(block);
    if (text != null) return text;
  }
  return null;
}

export function extractResponseText(bodyJson: string): string | null {
  try {
    const parsed = JSON.parse(bodyJson) as ResBody;
    return firstBlockText(parsed.content);
  } catch {
    return null;
  }
}

export function extractStopReason(bodyJson: string): string | null {
  try {
    const parsed = JSON.parse(bodyJson) as ResBody;
    return parsed.stop_reason ?? null;
  } catch {
    return null;
  }
}
