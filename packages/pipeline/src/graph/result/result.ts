import type { CanonicalNode, ErrorKind, MessageDeltas, ToolNode } from '../../types.ts';
import type { ExecutionGraph } from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Tool result/error matching — a PURE TABLE PASS over the mechanical execution
// graph (after stage 5, before semantic enrichment). A tool call's result is NOT
// on the tool node itself: it arrives as a `tool_result` block, keyed by
// `tool_use_id`, in the request messages of the inference that consumed it (its
// stage-5 `requestMessagesDelta`). This module indexes those blocks by
// `tool_use_id`, matches each `tool` node to its result, and annotates the node
// with `is_error`, a deterministic `error_kind`, and a ≤500-char `result_summary`.
//
// Tool calls with NO matching result are REPORTED (returned in `unmatched`, never
// silently dropped); their `is_error` stays absent (NULL). No LLM — every field
// is read or rule-derived from the trace. Pure module (no node:* imports).
// ════════════════════════════════════════════════════════════════════════════

const RESULT_SUMMARY_MAX = 500;

/** A tool_result block as it appears in an inference's request messages. `content`
 *  is the result/error text (a string, or an array of `{ text }` blocks). */
interface ToolResultBlock {
  readonly tool_use_id: string;
  readonly is_error?: boolean;
  readonly content?: unknown;
}

function isToolResultBlock(block: unknown): block is ToolResultBlock {
  if (typeof block !== 'object' || block === null) return false;
  const candidate = block as { type?: unknown; tool_use_id?: unknown };
  return candidate.type === 'tool_result' && typeof candidate.tool_use_id === 'string';
}

function resultBlocksOf(deltas: MessageDeltas | undefined): ToolResultBlock[] {
  return (deltas?.requestMessagesDelta ?? []).flatMap((message) =>
    Array.isArray(message.content) ? message.content.filter(isToolResultBlock) : [],
  );
}

/** tool_use_id → its tool_result block, indexed over every inference's request
 *  messages. Last write wins (a tool_use_id appears in exactly one result). */
function indexResultsByToolUseId(graph: ExecutionGraph): Map<string, ToolResultBlock> {
  const byId = new Map<string, ToolResultBlock>();
  for (const deltas of Object.values(graph.deltas)) {
    for (const block of resultBlocksOf(deltas)) byId.set(block.tool_use_id, block);
  }
  return byId;
}

// ── Result text + summary ──────────────────────────────────────────────────────

function blockText(block: unknown): string {
  if (typeof block === 'string') return block;
  if (typeof block !== 'object' || block === null) return '';
  const text = (block as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}

/** The result/error text of a tool_result, flattening the array-of-blocks form. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(blockText).join('\n').trim();
  return '';
}

function summarize(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= RESULT_SUMMARY_MAX) return trimmed;
  return `${trimmed.slice(0, RESULT_SUMMARY_MAX - 1).trimEnd()}…`;
}

// ── error_kind classifier (deterministic, no LLM) ──────────────────────────────
// Rules are matched in priority order against the lower-cased error text. The
// closed set is `not_found | invalid_args | permission | timeout | nonzero_exit |
// other`. Returns 'other' when nothing more specific matches an error.

// An Edit/Write that fails because the target text wasn't found in the file is a
// BAD-ARGUMENT failure (the old_string was wrong), NOT a file-not-found. These
// phrases are checked before the generic `not_found` rule so they win.
function isFailedMatch(text: string): boolean {
  return (
    text.includes('no match') ||
    text.includes('did not match') ||
    text.includes('string to replace') ||
    text.includes('not unique')
  );
}

function isNotFound(text: string): boolean {
  return (
    text.includes('no such file') ||
    text.includes('enoent') ||
    text.includes('command not found') ||
    text.includes('file not found') ||
    text.includes('path not found') ||
    text.includes('does not exist')
  );
}

function isInvalidArgs(text: string): boolean {
  return (
    isFailedMatch(text) ||
    text.includes('invalid') ||
    text.includes('parse error') ||
    text.includes('parsing error') ||
    text.includes('bad argument') ||
    text.includes('expected') ||
    text.includes('must be')
  );
}

function isPermission(text: string): boolean {
  return (
    text.includes('permission denied') || text.includes('eacces') || text.includes('not permitted')
  );
}

function isTimeout(text: string): boolean {
  return text.includes('timed out') || text.includes('timeout') || text.includes('etimedout');
}

function isNonzeroExit(text: string): boolean {
  return /exit code\s+[1-9]/.test(text) || text.includes('nonzero exit') || text.includes('killed');
}

function classifyErrorKind(rawText: string): ErrorKind {
  const text = rawText.toLowerCase();
  if (isFailedMatch(text)) return 'invalid_args';
  if (isNotFound(text)) return 'not_found';
  if (isPermission(text)) return 'permission';
  if (isTimeout(text)) return 'timeout';
  if (isInvalidArgs(text)) return 'invalid_args';
  if (isNonzeroExit(text)) return 'nonzero_exit';
  return 'other';
}

// ── Annotation ─────────────────────────────────────────────────────────────────

function annotateTool(tool: ToolNode, result: ToolResultBlock): ToolNode {
  const text = resultText(result.content);
  const isError = result.is_error === true;
  const summary = summarize(text);
  return {
    ...tool,
    is_error: isError,
    ...(isError ? { error_kind: classifyErrorKind(text) } : {}),
    ...(summary != null ? { result_summary: summary } : {}),
  };
}

function annotatedNode(
  node: CanonicalNode,
  resultsByToolUseId: ReadonlyMap<string, ToolResultBlock>,
  unmatched: string[],
): CanonicalNode {
  if (node.type !== 'tool' || node.tool_use_id == null) return node;
  const result = resultsByToolUseId.get(node.tool_use_id);
  if (result == null) {
    unmatched.push(node.id);
    return node;
  }
  return annotateTool(node, result);
}

/** The outcome of matching: the graph with tool nodes annotated, plus the ids of
 *  tool calls that had no matching result (reported, never dropped). */
export interface ToolResultMatch {
  readonly graph: ExecutionGraph;
  readonly unmatchedToolIds: readonly string[];
}

/**
 * Matches every `tool` node to its `tool_result` (by `tool_use_id`) and annotates
 * it with `is_error`, `error_kind`, and `result_summary`. The node table is
 * rebuilt with the annotations; deltas, edges and entities are returned unchanged.
 * Pure and deterministic. Unmatched tool calls are returned in `unmatchedToolIds`.
 */
export function matchToolResults(graph: ExecutionGraph): ToolResultMatch {
  const resultsByToolUseId = indexResultsByToolUseId(graph);
  const unmatchedToolIds: string[] = [];
  const nodes: Record<string, CanonicalNode> = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    nodes[id] = annotatedNode(node, resultsByToolUseId, unmatchedToolIds);
  }
  return { graph: { ...graph, nodes }, unmatchedToolIds };
}

export { classifyErrorKind };
