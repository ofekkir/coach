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
interface CardField {
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
 *  the renderer keys its glyph/role on (e.g. `tool.execution` → `execution`).
 *  `tag` is the mono type tag shown above the title (e.g. `ACTION · WEBFETCH`);
 *  `title` is the verb that leads the card (`what[0]`); `subtitle` the second
 *  `what[]` line; `model` the machine id shown at the card's foot. */
export interface NodeCard {
  readonly type: string;
  readonly tag: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly model?: string;
  readonly fields: readonly CardField[];
  readonly metrics: CardMetrics;
}

// Truncation limits (chars) for title lines, and decimal precision for metrics.
const INTERACTION_TITLE_MAX = 40;
const SESSION_TITLE_MAX = 24;
// The prompt anchor allows two lines; clamp so a pasted blob never sizes the card.
const PROMPT_TITLE_MAX = 120;
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

const TOPBAR_COST_DECIMALS = 3;

/** Top-bar run duration, e.g. `18.4s`. */
export function formatRunDuration(ms: number): string {
  return formatDuration(ms);
}

/** Top-bar run cost, e.g. `$0.045`. */
export function formatRunCost(usd: number): string {
  return `$${usd.toFixed(TOPBAR_COST_DECIMALS)}`;
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

/** Display type + tag + title + structural fields for a node. `what` (set by the
 *  semantic stage) supplies the verb (`what[0]`) and sub-verb (`what[1]`), with
 *  the structural name/model as fallback. Content lives in the JSON viewer. */
interface CardShape {
  type: string;
  tag: string;
  title?: string | undefined;
  subtitle?: string | undefined;
  model?: string | undefined;
  fields?: readonly CardField[] | undefined;
}

const MAIN_THREAD_SOURCE = 'repl_main_thread';

/** Mono tag suffix from a verb node's `source` — surfaced only for off-spine
 *  threads (background/away), since the main thread needs no qualifier. */
function sourceSuffix(source: string | undefined): string {
  if (source == null || source === '' || source === MAIN_THREAD_SOURCE) return '';
  return ` · ${source.toUpperCase()}`;
}

function toolTag(name: string | undefined): string {
  return name != null && name !== '' ? `ACTION · ${name.toUpperCase()}` : 'ACTION';
}

function actionShape(node: ActionNode): CardShape {
  return {
    type: 'action',
    tag: toolTag(node.name),
    title: node.what[0] ?? node.name,
    subtitle: node.what[1],
  };
}

function inferenceShape(node: InferenceNode): CardShape {
  return {
    type: 'inference',
    tag: `INFERENCE${sourceSuffix(node.source)}`,
    title: node.what[0] ?? node.model,
    subtitle: node.what[1],
    model: node.model,
  };
}

function llmRequestShape(node: LlmRequestNode): CardShape {
  return {
    type: 'llm_request',
    tag: `INFERENCE${sourceSuffix(node.source)}`,
    title: node.model,
    model: node.model,
    fields: field('source', node.source),
  };
}

// Each builder is typed to the node member its discriminant selects, so field
// access inside is checked against the right shape (no wide-union guards).
type ShapeBuilders = {
  [N in GraphNode as N['type']]?: (node: N, index: number) => CardShape;
};

const TYPE_SHAPE_BUILDERS: ShapeBuilders = {
  agent: (n) => ({ type: 'agent', tag: 'AGENT', title: n.user_id }),
  session: (n, i) => ({ type: 'session', tag: 'SESSION · OTEL', title: sessionTitle(n, i) }),
  interaction: (n, i) => ({
    type: 'interaction',
    tag: 'INTERACTION',
    title: interactionTitle(n, i),
  }),
  user_prompt: (n) => ({
    type: 'user_prompt',
    tag: 'USER PROMPT · GOAL SOURCE',
    title: truncate(collapseWhitespace(n.prompt).trim(), PROMPT_TITLE_MAX),
  }),
  llm_request: (n) => llmRequestShape(n),
  tool: (n) => ({ type: 'tool', tag: toolTag(n.name), title: n.name }),
  'tool.blocked_on_user': () => ({ type: 'blocked_on_user', tag: 'WAIT' }),
  'tool.execution': () => ({ type: 'execution', tag: 'EXECUTION' }),
  hook: (n) => ({ type: 'hook', tag: `HOOK · ${n.name.toUpperCase()}`, title: n.name }),
  action: (n) => actionShape(n),
  inference: (n) => inferenceShape(n),
};

function shapeOf(node: GraphNode, index: number): CardShape {
  // The table is keyed by discriminant; TS can't correlate the lookup with the
  // node's narrowed type, so assert the resolved builder accepts this node.
  const builder = TYPE_SHAPE_BUILDERS[node.type] as
    | ((node: GraphNode, index: number) => CardShape)
    | undefined;
  return builder?.(node, index) ?? { type: node.type, tag: node.type.toUpperCase() };
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
    tag: shape.tag,
    ...(shape.title != null && shape.title !== '' ? { title: shape.title } : {}),
    ...(shape.subtitle != null && shape.subtitle !== '' ? { subtitle: shape.subtitle } : {}),
    ...(shape.model != null && shape.model !== '' ? { model: shape.model } : {}),
    fields: shape.fields ?? [],
    metrics: metricsOf(node),
  };
}
