interface ReqBody {
  messages?: { role: string; content: string | { type: string; text?: string }[] }[];
}

interface ResBody {
  content?: { type: string; text?: string; thinking?: string; name?: string }[];
  stop_reason?: string;
}

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
  try {
    const parsed = JSON.parse(bodyJson) as ReqBody;
    return lastUserTextFromParsed(parsed.messages);
  } catch {
    return lastUserTextFromRaw(bodyJson);
  }
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
