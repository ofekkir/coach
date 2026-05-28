import type { TraceNode } from '../etl/types.ts';

// Keep TempoTrace and LogEntry re-exported so existing imports don't break
export type { TempoTrace, LogEntry } from '../etl/types.ts';

function sanitize(text: string): string {
  return text.replace(/`/g, "'").replace(/"/g, "'");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  return `${String(Math.round(ms))}ms`;
}

function buildNodeLabel(node: TraceNode): string {
  const lines: string[] = [];

  switch (node.type) {
    case 'interaction':
      lines.push('interaction');
      if (node.prompt != null) lines.push(truncate(node.prompt.replace(/\s+/g, ' '), 80));
      break;
    case 'llm_request':
      lines.push('llm_request');
      if (node.model != null) lines.push(`model: ${node.model}`);
      if (node.source != null) lines.push(`source: ${node.source}`);
      if (node.prompt != null) lines.push(truncate(node.prompt.replace(/\s+/g, ' '), 80));
      if (node.response != null) lines.push(truncate(node.response.replace(/\s+/g, ' '), 80));
      break;
    case 'tool':
      lines.push('tool');
      if (node.name != null) lines.push(`name: ${node.name}`);
      if (node.tool_input != null) lines.push(`input: ${node.tool_input}`);
      break;
    case 'tool.blocked_on_user':
      lines.push('blocked_on_user');
      break;
    case 'tool.execution':
      lines.push('execution');
      break;
    case 'hook':
      lines.push('hook');
      if (node.name != null) lines.push(`name: ${node.name}`);
      break;
    default:
      lines.push(node.type);
  }

  if (node.duration_ms != null) lines.push(`duration: ${formatDuration(node.duration_ms)}`);

  if (node.tokens_in != null) lines.push(`tokens in: ${String(node.tokens_in)}`);
  if (node.tokens_out != null) lines.push(`tokens out: ${String(node.tokens_out)}`);

  if (node.cost_usd != null) lines.push(`cost: $${node.cost_usd.toFixed(6)}`);

  return lines.join('\n');
}

export function traceToMermaid(nodes: readonly TraceNode[]): string {
  const nodeLines = nodes.map((n) => {
    const label = sanitize(buildNodeLabel(n));
    return `  ${n.id}["\`${label}\`"]`;
  });

  const edgeLines = nodes
    .filter((n) => n.parent != null)
    .map((n) => `  ${String(n.parent)} --> ${n.id}`);

  return ['graph TD', ...nodeLines, '', ...edgeLines].join('\n');
}
