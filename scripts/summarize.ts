import { readFileSync, writeFileSync } from 'node:fs';
import type { TraceNode } from '../src/etl/types.ts';

function summarizeRequest(raw: string): string {
  const parsed = JSON.parse(raw) as {
    messages?: { role: string; content: unknown }[];
  };
  const lastUser = [...(parsed.messages ?? [])].reverse().find((m) => m.role === 'user');
  const content = lastUser?.content;
  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = (content as { type: string; text?: string }[])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join(' ');
  } else {
    text = JSON.stringify(content ?? '');
  }
  return text.slice(0, 120).replace(/\s+/g, ' ').trim();
}

function summarizeResponse(raw: string): string {
  const parsed = JSON.parse(raw) as {
    content?: { type: string; text?: string; name?: string }[];
  };
  const blocks = parsed.content ?? [];
  const parts: string[] = [];

  const textBlock = blocks.find((b) => b.type === 'text');
  if (textBlock?.text) {
    parts.push(textBlock.text.slice(0, 80).replace(/\s+/g, ' ').trim());
  }

  const toolBlock = blocks.find((b) => b.type === 'tool_use');
  if (toolBlock?.name) {
    parts.push(`[tool: ${toolBlock.name}]`);
  }

  return parts.join(' + ');
}

const nodes = JSON.parse(readFileSync('out.nodes.json', 'utf8')) as TraceNode[];

const results = nodes.map((node) => {
  if (node.type !== 'llm_request' || node.raw_request == null) return node;
  return {
    ...node,
    request: summarizeRequest(node.raw_request),
    ...(node.raw_response != null && { response: summarizeResponse(node.raw_response) }),
  };
});

writeFileSync('tmp.nodes.summarized.json', JSON.stringify(results, null, 2) + '\n');
console.log('wrote tmp.nodes.summarized.json');
