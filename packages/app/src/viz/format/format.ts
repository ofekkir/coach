import type {
  ActionNode,
  GraphNode,
  InferenceNode,
  InteractionNode,
  LlmRequestNode,
  SessionNode,
} from '@coach/pipeline';

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

function actionLines(node: ActionNode): string[] {
  // `what` is always set by the semantic stage; `name` is the structural fallback.
  return [
    'action',
    ...(node.what !== '' ? [node.what] : optionalLine(node.name, (n) => `name: ${n}`)),
    ...optionalLine(node.tool_input, formatToolInput),
  ];
}

function inferenceLines(node: InferenceNode): string[] {
  const responseText =
    node.response_messages != null ? firstResponseText(node.response_messages) : null;
  return [
    'inference',
    ...(node.what !== '' ? [node.what] : optionalLine(node.model, (m) => `model: ${m}`)),
    ...optionalLine(responseText, (o) => `output: ${truncate(collapseWhitespace(o), 500)}`),
  ];
}

function llmRequestLines(node: LlmRequestNode): string[] {
  const lines = ['llm_request'];
  if (node.model != null) lines.push(`model: ${node.model}`);
  if (node.source != null) lines.push(`source: ${node.source}`);
  const responseText =
    node.response_messages != null ? firstResponseText(node.response_messages) : null;
  if (responseText != null) lines.push(collapseWhitespace(responseText));
  return lines;
}

/** Title for an interaction node: a short prompt preview, else a positional fallback. */
function interactionTitle(node: InteractionNode, index = 0): string {
  if (node.prompt != null && node.prompt.trim() !== '') {
    return truncate(collapseWhitespace(node.prompt).trim(), 40);
  }
  return `interaction ${String(index + 1)}`;
}

/** Title for a session node: a short session_id preview, else a positional fallback. */
function sessionTitle(node: SessionNode, index = 0): string {
  if (node.session_id.trim() !== '') {
    return truncate(node.session_id, 24);
  }
  return `session ${String(index + 1)}`;
}

/** Title for a thread, derived from its emitting loop source. */
export function threadTitle(source: string): string {
  return `thread: ${source}`;
}

// Each builder is typed to the node member its discriminant selects, so field
// access inside is checked against the right shape (no wide-union guards).
type LineBuilders = {
  [N in GraphNode as N['type']]?: (node: N, index: number) => string[];
};

const TYPE_LINE_BUILDERS: LineBuilders = {
  agent: (n) => ['agent', ...optionalLine(n.user_id)],
  session: (n, i) => ['session', sessionTitle(n, i)],
  interaction: (n, i) => ['interaction', interactionTitle(n, i)],
  user_prompt: (n) => ['user_prompt', ...optionalLine(n.prompt, collapseWhitespace)],
  llm_request: (n) => llmRequestLines(n),
  tool: (n) => [
    'tool',
    ...optionalLine(n.name, (x) => `name: ${x}`),
    ...optionalLine(n.tool_input, formatToolInput),
  ],
  'tool.blocked_on_user': () => ['blocked_on_user'],
  'tool.execution': () => ['execution'],
  hook: (n) => ['hook', ...optionalLine(n.name, (x) => `name: ${x}`)],
  action: (n) => actionLines(n),
  inference: (n) => inferenceLines(n),
};

function typeLines(node: GraphNode, index: number): string[] {
  // The table is keyed by discriminant; TS can't correlate the lookup with the
  // node's narrowed type, so assert the resolved builder accepts this node.
  const builder = TYPE_LINE_BUILDERS[node.type] as
    | ((node: GraphNode, index: number) => string[])
    | undefined;
  return builder?.(node, index) ?? [node.type];
}

/** The full ordered label lines for a node: `[type, ...details, duration?, tokens?, cost?]`.
 *  Line 0 is always the structural type — the renderer keys its badge/color on it.
 *  `index` supplies positional fallbacks for session/interaction titles. */
export function buildLabelLines(node: GraphNode, index = 0): string[] {
  const lines = typeLines(node, index);

  // `in` narrows to the members carrying each field and, since these are only
  // ever set when present, confirms a real value (no extra null guard needed).
  if ('duration_ms' in node) lines.push(`duration: ${formatDuration(node.duration_ms)}`);
  if ('tokens_in' in node) lines.push(`tokens in: ${String(node.tokens_in)}`);
  if ('tokens_out' in node) lines.push(`tokens out: ${String(node.tokens_out)}`);
  if ('cost_usd' in node) lines.push(`cost: $${node.cost_usd.toFixed(6)}`);

  return lines;
}
