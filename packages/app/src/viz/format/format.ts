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
// derives a typed `NodeCard` — the curated, at-a-glance summary the renderer
// draws. The card carries ONLY structural facts the canonical model guarantees
// (display type, a title, structural key/values, numeric metrics). It never
// interprets harness-shaped CONTENT (response content blocks, tool_input JSON):
// that flows untouched into the JSON viewer in the details panel. Adding a node
// type or field touches this builder; new content shapes need no change here.
// ════════════════════════════════════════════════════════════════════════════

/** A single structural key/value shown on the card body and details header. */
export interface CardField {
  readonly label: string;
  readonly value: string;
}

/** Raw numeric metrics — the renderer formats them (ms, counts, dollars). */
export interface CardMetrics {
  readonly durationMs?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly costUsd?: number;
}

/** The typed view-model for one node card. `type` is the display discriminant
 *  the renderer keys its badge/color on (e.g. `tool.execution` → `execution`). */
export interface NodeCard {
  readonly type: string;
  readonly title?: string;
  readonly fields: readonly CardField[];
  readonly metrics: CardMetrics;
}

// Truncation limits (chars) for title lines, and decimal precision for metrics.
const INTERACTION_TITLE_MAX = 40;
const SESSION_TITLE_MAX = 24;
const SUBMS_DECIMALS = 2;
const COST_DECIMALS = 6;
const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(SUBMS_DECIMALS)}ms`;
  if (ms < MS_PER_SECOND) return `${String(Math.round(ms))}ms`;
  if (ms < MS_PER_MINUTE) return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
  return `${(ms / MS_PER_MINUTE).toFixed(1)}min`;
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

/** Renders a card's numeric metrics for display: the duration becomes a chip,
 *  token counts and cost collapse into one secondary line. */
export function formatMetrics(metrics: CardMetrics): {
  duration: string | null;
  secondary: string | null;
} {
  const duration = metrics.durationMs != null ? formatDuration(metrics.durationMs) : null;
  const parts: string[] = [];
  if (metrics.tokensIn != null) parts.push(`in ${String(metrics.tokensIn)}`);
  if (metrics.tokensOut != null) parts.push(`out ${String(metrics.tokensOut)}`);
  if (metrics.costUsd != null) parts.push(`$${metrics.costUsd.toFixed(COST_DECIMALS)}`);
  return { duration, secondary: parts.length > 0 ? parts.join(' · ') : null };
}

/** Title for an interaction node: a short prompt preview, else a positional fallback. */
function interactionTitle(node: InteractionNode, index: number): string {
  if (node.prompt.trim() !== '') {
    return truncate(collapseWhitespace(node.prompt).trim(), INTERACTION_TITLE_MAX);
  }
  return `interaction ${String(index + 1)}`;
}

/** Title for a session node: a short session_id preview, else a positional fallback. */
function sessionTitle(node: SessionNode, index: number): string {
  if (node.session_id.trim() !== '') {
    return truncate(node.session_id, SESSION_TITLE_MAX);
  }
  return `session ${String(index + 1)}`;
}

function field(label: string, value: string | undefined): CardField[] {
  return value != null && value !== '' ? [{ label, value }] : [];
}

/** Display type + title + structural fields for a node. `what` (set by the
 *  semantic stage) is the headline for relabeled nodes, with the structural
 *  name/model as fallback. Content lives in the JSON viewer, never here. */
interface CardShape {
  type: string;
  title?: string | undefined;
  fields?: readonly CardField[] | undefined;
}

function actionShape(node: ActionNode): CardShape {
  return { type: 'action', title: node.what.length > 0 ? node.what.join(' · ') : node.name };
}

function inferenceShape(node: InferenceNode): CardShape {
  return { type: 'inference', title: node.what.length > 0 ? node.what.join(' · ') : node.model };
}

function llmRequestShape(node: LlmRequestNode): CardShape {
  return { type: 'llm_request', title: node.model, fields: field('source', node.source) };
}

// Each builder is typed to the node member its discriminant selects, so field
// access inside is checked against the right shape (no wide-union guards).
type ShapeBuilders = {
  [N in GraphNode as N['type']]?: (node: N, index: number) => CardShape;
};

const TYPE_SHAPE_BUILDERS: ShapeBuilders = {
  agent: (n) => ({ type: 'agent', title: n.user_id }),
  session: (n, i) => ({ type: 'session', title: sessionTitle(n, i) }),
  interaction: (n, i) => ({ type: 'interaction', title: interactionTitle(n, i) }),
  user_prompt: (n) => ({ type: 'user_prompt', title: collapseWhitespace(n.prompt) }),
  llm_request: (n) => llmRequestShape(n),
  tool: (n) => ({ type: 'tool', title: n.name }),
  'tool.blocked_on_user': () => ({ type: 'blocked_on_user' }),
  'tool.execution': () => ({ type: 'execution' }),
  hook: (n) => ({ type: 'hook', title: n.name }),
  action: (n) => actionShape(n),
  inference: (n) => inferenceShape(n),
};

function shapeOf(node: GraphNode, index: number): CardShape {
  // The table is keyed by discriminant; TS can't correlate the lookup with the
  // node's narrowed type, so assert the resolved builder accepts this node.
  const builder = TYPE_SHAPE_BUILDERS[node.type] as
    | ((node: GraphNode, index: number) => CardShape)
    | undefined;
  return builder?.(node, index) ?? { type: node.type };
}

function metricsOf(node: GraphNode): CardMetrics {
  // `in` narrows to the members carrying each field and, since these are only
  // ever set when present, confirms a real value (no extra null guard needed).
  return {
    ...('duration_ms' in node ? { durationMs: node.duration_ms } : {}),
    ...('tokens_in' in node ? { tokensIn: node.tokens_in } : {}),
    ...('tokens_out' in node ? { tokensOut: node.tokens_out } : {}),
    ...('cost_usd' in node ? { costUsd: node.cost_usd } : {}),
  };
}

/** The curated card for a node. `index` supplies positional fallbacks for
 *  session/interaction titles. */
export function buildNodeCard(node: GraphNode, index = 0): NodeCard {
  const shape = shapeOf(node, index);
  return {
    type: shape.type,
    ...(shape.title != null && shape.title !== '' ? { title: shape.title } : {}),
    fields: shape.fields ?? [],
    metrics: metricsOf(node),
  };
}
