import {
  actionLabel,
  classifyIntent,
  coarseAction,
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
  markerLabel,
  parseToolInput,
  responseText,
  responseToolCall,
  structuralPrefix,
} from './derive.ts';
import { toolComment, toolOntologyAction, toolPhrases } from './tool-intent.ts';

// Why: no tree walk — with deltas in their own layer, enrichment depends only on
// a node's own data (and its stage-5 deltas, read by id), so a flat table pass is
// sufficient and "is this enriched?" reduces to "does a `semantics[id]` row exist".
// Fully deterministic by design (every label comes from the injected
// SemanticsConfig, no model) so the same trace always yields the same labels.

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
  // Why: text that precedes a tool call is preamble to the action, not a terminal
  // message — so a terminal message requires final text and no following tool call.
  const isTerminalMessage = responseText(response) != null && responseToolCall(response) == null;
  if (isTerminalMessage) return { what: [...prefix, actionLabel(config, TERMINAL_MESSAGE_ACTION)] };
  if (prefix.length > 0) return { what: prefix };
  return { what: [node.model] };
}

/** The closed `action` bucket for a tool node — a coarsening of the ontology
 *  action the config resolves for this call. `toolOntologyAction` resolves a single
 *  ontology action id (tool spec, shell command grammar, or `invoke` for MCP), and
 *  `coarseAction` rolls it up via the ontology's `coarse` field. Every tool node
 *  yields a non-NULL bucket; distinct from the free-form `semantics.what`. */
function toolAction(node: ToolNode, config: SemanticsConfig): string {
  const input = parseToolInput(node.tool_input);
  return coarseAction(config, toolOntologyAction(config, node.name, input));
}

function toolFields(node: ToolNode, config: SemanticsConfig): SemanticFields {
  const input = parseToolInput(node.tool_input);
  const comment = toolComment(config, node.name, input);
  return {
    what: toolPhrases(config, node.name, input),
    ...(comment != null ? { comment } : {}),
  };
}

/** The closed `intent_category` for an interaction, derived from its prompt by the
 *  same deterministic labeler mechanism as `action`. Every interaction yields a
 *  non-NULL category (`other` is the fallback). The interaction-level analogue of
 *  `toolAction`. */
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

/**
 * Enriches an ExecutionGraph by populating its `semantics` table (one sparse row
 * per relabeled `tool` / `llm_request` node), its `actions` table (one closed
 * `action` bucket per `tool` node — dense over tool nodes, never NULL), and its
 * `intents` table (one closed `intent_category` per `interaction` node — dense
 * over interactions, never NULL). All keyed by node id; `action`/`intent_category`
 * are the coarse closed dimensions, distinct from the free-form `semantics.what`.
 * Pure and deterministic — labels come from the injected SemanticsConfig, actions
 * from `(name, bash command)` and intents from the prompt alone. The node table,
 * deltas, edges and entities are returned unchanged.
 */
export function enrichExecutionGraph(
  graph: ExecutionGraph,
  config: SemanticsConfig,
): ExecutionGraph {
  const semantics: Record<string, SemanticFields> = {};
  const actions: Record<string, string> = {};
  const intents: Record<string, IntentCategory> = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type === 'tool') actions[id] = toolAction(node, config);
    if (node.type === 'interaction') intents[id] = interactionIntent(node);
    const fields = semanticFieldsOf(node, graph.deltas[id], config);
    if (fields != null) semantics[id] = fields;
  }
  return { ...graph, semantics, actions, intents };
}
