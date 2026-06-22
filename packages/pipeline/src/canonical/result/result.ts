// Tool result/error matching — a canonical-stage pass (stage 3) that completes
// each `tool` node with its outcome. A tool call's result is NOT on the tool node
// as it arrives: it comes back as a `tool_result` block, keyed by `tool_use_id`,
// in the `request_messages` of the inference that consumed it. This indexes those
// blocks across the session's `llm_request` nodes and annotates each matched tool
// node with `is_error`, a deterministic `error_kind`, `output_size`, and (on
// failures only) a ≤500-char `error_message`.
//
// `request_messages` is populated by BOTH the native and OTEL canonical paths, so
// this one pass is harness-agnostic — no separate graph stage, no `deltas`. Tool
// calls with no matching result keep `is_error` NULL (queryable as such), never
// silently coerced. No LLM — every field is read or rule-derived. Pure module.

import type { CanonicalNode, ErrorKind, RequestMessage, ToolNode } from '../../types.ts';

const ERROR_MESSAGE_MAX = 500;

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

function resultBlocksOf(messages: readonly RequestMessage[] | undefined): ToolResultBlock[] {
  return (messages ?? []).flatMap((message) =>
    Array.isArray(message.content) ? message.content.filter(isToolResultBlock) : [],
  );
}

/** tool_use_id → its tool_result block, indexed over every llm_request node's
 *  request messages. Last write wins (a tool_use_id appears in exactly one result). */
function indexResultsByToolUseId(nodes: readonly CanonicalNode[]): Map<string, ToolResultBlock> {
  const byId = new Map<string, ToolResultBlock>();
  for (const node of nodes) {
    if (node.type !== 'llm_request') continue;
    for (const block of resultBlocksOf(node.request_messages)) byId.set(block.tool_use_id, block);
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
  if (trimmed.length <= ERROR_MESSAGE_MAX) return trimmed;
  return `${trimmed.slice(0, ERROR_MESSAGE_MAX - 1).trimEnd()}…`;
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
    output_size: text.length,
    ...(isError ? { error_kind: classifyErrorKind(text) } : {}),
    ...(isError && summary != null ? { error_message: summary } : {}),
  };
}

function annotatedNode(
  node: CanonicalNode,
  resultsByToolUseId: ReadonlyMap<string, ToolResultBlock>,
): CanonicalNode {
  if (node.type !== 'tool' || node.tool_use_id == null) return node;
  const result = resultsByToolUseId.get(node.tool_use_id);
  return result == null ? node : annotateTool(node, result);
}

/**
 * Completes every `tool` node with its outcome (`is_error`, `error_kind`,
 * `output_size`, `error_message`) by matching its `tool_use_id` to the
 * `tool_result` block in the consuming inference's request messages. Pure and
 * deterministic; nodes without a matched result are returned unchanged.
 */
export function attachToolResults(nodes: readonly CanonicalNode[]): CanonicalNode[] {
  const resultsByToolUseId = indexResultsByToolUseId(nodes);
  return nodes.map((node) => annotatedNode(node, resultsByToolUseId));
}

export { classifyErrorKind };
