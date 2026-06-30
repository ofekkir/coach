import {
  actionLabel,
  classifyIntent,
  type IntentCategory,
  type SemanticsConfig,
} from '@coach/semantics';

import type {
  CanonicalNode,
  InteractionNode,
  LlmRequestNode,
  MessageDeltas,
  SemanticFields,
  ToolNode,
} from '../../types.ts';
import type { ExecutionGraph } from '../types.ts';

import {
  markerEntries,
  parseToolInput,
  responseText,
  responseToolCall,
  structuralEntries,
} from './derive.ts';
import { toolComment, toolEntries } from './tool-intent.ts';

// ════════════════════════════════════════════════════════════════════════════
// Semantic enrichment stage (stage 6) — a PURE TABLE PASS. It iterates the node
// table and, for each mechanical `tool` / `llm_request` node, derives its
// `SemanticFields` (an ordered list of `SemanticEntry` + optional `comment`) and
// writes a `semantics[id]` row. No tree walk: with deltas in their own layer,
// enrichment depends only on a node's own data (and its stage-5 deltas, read by id).
// "Is this enriched?" = "does a `semantics[id]` row exist".
//
// Each entry's `action` label is INPUT-INDEPENDENT (the act with the argument
// stripped); the argument survives as the entry's `rawPath` / `url`. Path GROUNDING
// (rawPath → repo_path/package) is NOT done here — it needs the session cwd and
// happens in stage 7 (graph/resolve). Fully
// deterministic: every label comes from the injected SemanticsConfig (tool intent,
// path conventions, structural roles, harness markers). No model. A genuine terminal
// assistant message (final text, turn does not end in a tool call) gets the generic
// `respond` act. Pure module (no node:* imports).
// ════════════════════════════════════════════════════════════════════════════

// The ontology action used to label a genuine terminal assistant message.
const TERMINAL_MESSAGE_ACTION = 'respond';

/** The ordered semantic entries for an inference, derived from its own thread-
 *  relative deltas (read by id from the `deltas` table). Falls back to the model
 *  id when there is no message delta to read. */
function inferenceFields(
  node: LlmRequestNode,
  deltas: MessageDeltas | undefined,
  config: SemanticsConfig,
): SemanticFields {
  const response = deltas?.responseMessagesDelta ?? [];
  const marker = markerEntries(config, deltas?.requestMessagesDelta ?? [], response);
  if (marker != null) return { entries: marker };
  const prefix = structuralEntries(config, response);
  // A terminal message is final text that does not precede a tool call. Text that
  // precedes a tool call is preamble to the action, not a terminal message.
  const isTerminalMessage = responseText(response) != null && responseToolCall(response) == null;
  if (isTerminalMessage)
    return { entries: [...prefix, { action: actionLabel(config, TERMINAL_MESSAGE_ACTION) }] };
  if (prefix.length > 0) return { entries: prefix };
  return { entries: [{ action: node.model }] };
}

function toolFields(node: ToolNode, config: SemanticsConfig): SemanticFields {
  const input = parseToolInput(node.tool_input);
  const comment = toolComment(config, node.name, input);
  return {
    entries: toolEntries(config, node.name, input),
    ...(comment != null ? { comment } : {}),
  };
}

/** The closed `intent_category` for an interaction, derived from its prompt by the
 *  deterministic labeler. Every interaction yields a non-NULL category (`other` is
 *  the fallback). Stays a node-level dimension, distinct from per-entry `action`. */
function interactionIntent(node: InteractionNode): IntentCategory {
  return classifyIntent(node.prompt);
}

function semanticFieldsOf(
  node: CanonicalNode,
  deltas: MessageDeltas | undefined,
  config: SemanticsConfig,
): SemanticFields | null {
  if (node.type === 'tool') return toolFields(node, config);
  if (node.type === 'llm_request') return inferenceFields(node, deltas, config);
  return null;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Enriches an ExecutionGraph by populating its `semantics` table (one sparse
 * `SemanticFields` per relabeled `tool` / `llm_request` node — an ordered list of
 * input-independent `SemanticEntry` rows) and its `intents` table (one closed
 * `intent_category` per `interaction` node — dense over interactions, never NULL).
 * All keyed by node id. Pure and deterministic — labels come from the injected
 * SemanticsConfig, intents from the prompt alone. The per-entry `action` bucket is
 * carried inside `semantics`; path grounding is deferred to stage 7. The node table,
 * deltas, edges and entities are returned unchanged.
 */
export function enrichExecutionGraph(
  graph: ExecutionGraph,
  config: SemanticsConfig,
): ExecutionGraph {
  const semantics: Record<string, SemanticFields> = {};
  const intents: Record<string, IntentCategory> = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type === 'interaction') intents[id] = interactionIntent(node);
    const fields = semanticFieldsOf(node, graph.deltas[id], config);
    if (fields != null) semantics[id] = fields;
  }
  return { ...graph, semantics, intents };
}
