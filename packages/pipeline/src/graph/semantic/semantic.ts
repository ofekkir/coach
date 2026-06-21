import type {
  CanonicalNode,
  LlmRequestNode,
  MessageDeltas,
  SemanticFields,
  ToolNode,
} from '../../types.ts';
import type { ExecutionGraph } from '../types.ts';
import {
  actionLabel,
  classifyAction,
  strField,
  type Action,
  type SemanticsConfig,
} from '@coach/semantics';
import {
  markerLabel,
  parseToolInput,
  responseText,
  responseToolCall,
  structuralPrefix,
} from './derive.ts';
import { toolComment, toolPhrases } from './tool-intent.ts';

// ════════════════════════════════════════════════════════════════════════════
// Semantic enrichment stage — a PURE TABLE PASS. It iterates the node table and,
// for each mechanical `tool` / `llm_request` node, derives its `SemanticFields`
// (`what` + optional `comment`) and writes a `semantics[id]` row. No tree walk:
// with deltas in their own layer, enrichment depends only on a node's own data
// (and its stage-5 deltas, read by id). "Is this enriched?" = "does a
// `semantics[id]` row exist" — there is no `action`/`inference` node type.
//
// Fully deterministic: every label is derived from the injected SemanticsConfig
// (tool intent, path conventions, structural roles, harness markers). No model.
// A genuine terminal assistant message (final text, turn does not end in a tool
// call) is labeled with the generic `respond` act. Pure module (no node:* imports).
// ════════════════════════════════════════════════════════════════════════════

// The ontology action used to label a genuine terminal assistant message.
const TERMINAL_MESSAGE_ACTION = 'respond';

/** The ordered action phrases for an inference, derived from its own thread-
 *  relative deltas (read by id from the `deltas` table). Falls back to the model
 *  id when there is no message delta to read. */
function inferenceFields(
  node: LlmRequestNode,
  deltas: MessageDeltas | undefined,
  config: SemanticsConfig,
): SemanticFields {
  const response = deltas?.responseMessagesDelta ?? [];
  const marker = markerLabel(config, deltas?.requestMessagesDelta ?? [], response);
  if (marker != null) return { what: marker };
  const prefix = structuralPrefix(config, response);
  // A terminal message is final text that does not precede a tool call. Text that
  // precedes a tool call is preamble to the action, not a terminal message.
  const isTerminalMessage = responseText(response) != null && responseToolCall(response) == null;
  if (isTerminalMessage) return { what: [...prefix, actionLabel(config, TERMINAL_MESSAGE_ACTION)] };
  if (prefix.length > 0) return { what: prefix };
  return { what: [node.model] };
}

/** The closed `action` bucket for a tool node. Reads the Bash command inline from
 *  the tool input (the raw source item 4 will later promote to its own column);
 *  every tool node yields a non-NULL action. Distinct from `semantics.what`. */
function toolAction(node: ToolNode): Action {
  const command = strField(parseToolInput(node.tool_input), 'command');
  return classifyAction(node.name, command === '' ? undefined : command);
}

function toolFields(node: ToolNode, config: SemanticsConfig): SemanticFields {
  const input = parseToolInput(node.tool_input);
  const comment = toolComment(config, node.name, input);
  return {
    what: toolPhrases(config, node.name, input),
    ...(comment != null ? { comment } : {}),
  };
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
 * Enriches an ExecutionGraph by populating its `semantics` table (one sparse row
 * per relabeled `tool` / `llm_request` node) and its `actions` table (one closed
 * `action` bucket per `tool` node — dense over tool nodes, never NULL). Both are
 * keyed by node id; `action` is the coarse closed dimension, distinct from the
 * free-form `semantics.what`. Pure and deterministic — labels come from the
 * injected SemanticsConfig, actions from `(name, bash command)` alone. The node
 * table, deltas, edges and entities are returned unchanged.
 */
export function enrichExecutionGraph(
  graph: ExecutionGraph,
  config: SemanticsConfig,
): ExecutionGraph {
  const semantics: Record<string, SemanticFields> = {};
  const actions: Record<string, Action> = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type === 'tool') actions[id] = toolAction(node);
    const fields = semanticFieldsOf(node, graph.deltas[id], config);
    if (fields != null) semantics[id] = fields;
  }
  return { ...graph, semantics, actions };
}
