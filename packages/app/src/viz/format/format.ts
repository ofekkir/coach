import type { CanonicalNode } from '@coach/pipeline';

// ════════════════════════════════════════════════════════════════════════════
// Presentation lives in the APP, not the pipeline. The pipeline emits lossless,
// presentation-free nodes (a full CanonicalNode per execution node); this module
// derives every piece of display text the renderer needs: label lines, titles,
// durations, and the signed inter-step gap.
// ════════════════════════════════════════════════════════════════════════════

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  return `${String(Math.round(ms))}ms`;
}

/** Formats a signed millisecond gap from a `GraphEdge` into "+12ms" / "-3ms".
 *  Returns null when there is no meaningful gap to show. */
export function formatGap(gapMs: number | undefined): string | null {
  if (gapMs == null || !Number.isFinite(gapMs) || gapMs === 0) return null;
  return gapMs > 0 ? `+${formatDuration(gapMs)}` : `-${formatDuration(-gapMs)}`;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function optionalLine(
  value: string | null | undefined,
  format: (v: string) => string = (v) => v,
): string[] {
  return value != null ? [format(value)] : [];
}

function firstResponseText(
  messages: readonly { type: string; text?: string; thinking?: string; name?: string }[],
): string | null {
  for (const block of messages) {
    if (block.type === 'text' && block.text) return block.text;
    if (block.type === 'tool_use' && block.name) return `tool_use: ${block.name}`;
    if (block.type === 'thinking' && block.thinking && block.thinking !== '<REDACTED>') {
      return block.thinking;
    }
  }
  return null;
}

function llmRequestLines(node: CanonicalNode): string[] {
  const lines = ['llm_request'];
  if (node.model != null) lines.push(`model: ${node.model}`);
  if (node.source != null) lines.push(`source: ${node.source}`);
  if (node.prompt != null) lines.push(collapseWhitespace(node.prompt));
  const responseText =
    node.response_messages != null ? firstResponseText(node.response_messages) : null;
  if (responseText != null) lines.push(collapseWhitespace(responseText));
  return lines;
}

/** Title for an interaction node: a short prompt preview, else a positional fallback. */
function interactionTitle(node: CanonicalNode, index = 0): string {
  if (node.prompt != null && node.prompt.trim() !== '') {
    return truncate(collapseWhitespace(node.prompt).trim(), 40);
  }
  return `interaction ${String(index + 1)}`;
}

/** Title for a session node: a short session_id preview, else a positional fallback. */
function sessionTitle(node: CanonicalNode, index = 0): string {
  if (node.session_id != null && node.session_id.trim() !== '') {
    return truncate(node.session_id, 24);
  }
  return `session ${String(index + 1)}`;
}

/** Title for a thread, derived from its emitting loop source. */
export function threadTitle(source: string): string {
  return `thread: ${source}`;
}

function formatToolInput(input: string): string {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const pairs = Object.entries(parsed)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ');
    return truncate(pairs, 120);
  } catch {
    return truncate(input, 120);
  }
}

function typeLines(node: CanonicalNode, index: number): string[] {
  switch (node.type) {
    case 'agent':
      return ['agent', ...optionalLine(node.user_id)];
    case 'session':
      return ['session', sessionTitle(node, index)];
    case 'interaction':
      return ['interaction', interactionTitle(node, index)];
    case 'user_prompt':
      return ['user_prompt', ...optionalLine(node.prompt, collapseWhitespace)];
    case 'llm_request':
      return llmRequestLines(node);
    case 'tool':
      return [
        'tool',
        ...optionalLine(node.name, (n) => `name: ${n}`),
        ...optionalLine(node.tool_input, formatToolInput),
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

/** The full ordered label lines for a node: `[type, ...details, duration?, tokens?, cost?]`.
 *  Line 0 is always the structural type — the renderer keys its badge/color on it.
 *  `index` supplies positional fallbacks for session/interaction titles. */
export function buildLabelLines(node: CanonicalNode, index = 0): string[] {
  const lines = typeLines(node, index);

  if (node.duration_ms != null) lines.push(`duration: ${formatDuration(node.duration_ms)}`);
  if (node.tokens_in != null) lines.push(`tokens in: ${String(node.tokens_in)}`);
  if (node.tokens_out != null) lines.push(`tokens out: ${String(node.tokens_out)}`);
  if (node.cost_usd != null) lines.push(`cost: $${node.cost_usd.toFixed(6)}`);

  return lines;
}
