import type { CanonicalNode } from '../../types.ts';

function nsOf(ns: string | undefined): bigint {
  return ns != null ? BigInt(ns) : 0n;
}

export function compareStart(a: CanonicalNode, b: CanonicalNode): number {
  const diff = nsOf(a.start_time_ns) - nsOf(b.start_time_ns);
  if (diff !== 0n) return diff < 0n ? -1 : 1;
  const priority = (t: string) =>
    t === 'tool.blocked_on_user' ? 0 : t === 'tool.execution' ? 1 : 2;
  return priority(a.type) - priority(b.type);
}

export function sortByStart(list: CanonicalNode[]): CanonicalNode[] {
  return [...list].sort(compareStart);
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  return `${String(Math.round(ms))}ms`;
}

export function formatGap(prev: CanonicalNode, next: CanonicalNode): string | null {
  if (prev.end_time_ns == null || next.start_time_ns == null) return null;
  const ms = Number(BigInt(next.start_time_ns) - BigInt(prev.end_time_ns)) / 1_000_000;
  if (!Number.isFinite(ms) || ms === 0) return null;
  return ms > 0 ? `+${formatDuration(ms)}` : `-${formatDuration(-ms)}`;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function llmRequestLines(node: CanonicalNode): string[] {
  const lines = ['llm_request'];
  if (node.model != null) lines.push(`model: ${node.model}`);
  if (node.source != null) lines.push(`source: ${node.source}`);
  if (node.prompt != null) lines.push(node.prompt.replace(/\s+/g, ' '));
  if (node.response != null) lines.push(node.response.replace(/\s+/g, ' '));
  return lines;
}

function optionalLine(
  value: string | null | undefined,
  format: (v: string) => string = (v) => v,
): string[] {
  return value != null ? [format(value)] : [];
}

function buildTypeLines(node: CanonicalNode): string[] {
  switch (node.type) {
    case 'agent':
      return ['agent', ...optionalLine(node.user_id)];
    case 'session':
      return ['session', ...optionalLine(node.session_id)];
    case 'interaction':
      return ['interaction', ...optionalLine(node.prompt, (p) => p.replace(/\s+/g, ' '))];
    case 'llm_request':
      return llmRequestLines(node);
    case 'tool':
      return [
        'tool',
        ...optionalLine(node.name, (n) => `name: ${n}`),
        ...optionalLine(node.tool_input, (i) => `input: ${i}`),
      ];
    case 'tool.blocked_on_user':
      return ['blocked_on_user'];
    case 'tool.execution':
      return ['execution'];
    case 'hook':
      return ['hook', ...optionalLine(node.name, (n) => `name: ${n}`)];
    default:
      return [node.type];
  }
}

export function buildLabelLines(node: CanonicalNode): string[] {
  const lines = buildTypeLines(node);

  if (node.duration_ms != null) lines.push(`duration: ${formatDuration(node.duration_ms)}`);
  if (node.tokens_in != null) lines.push(`tokens in: ${String(node.tokens_in)}`);
  if (node.tokens_out != null) lines.push(`tokens out: ${String(node.tokens_out)}`);
  if (node.cost_usd != null) lines.push(`cost: $${node.cost_usd.toFixed(6)}`);

  return lines;
}
