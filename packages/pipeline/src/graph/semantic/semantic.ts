import type { GraphNode, LlmRequestNode } from '../../types.ts';
import type { ExecutionGraph, ExecutionNode } from '../types.ts';
import { actionLabel, type SemanticsConfig } from '@coach/semantics';
import {
  markerLabel,
  parseToolInput,
  responseText,
  responseToolCall,
  structuralPrefix,
} from './derive.ts';
import { toolComment, toolPhrases } from './tool-intent.ts';
import { mapExecutionNodes } from '../execution/traverse.ts';

// ════════════════════════════════════════════════════════════════════════════
// Semantic enrichment stage — converts mechanical tool/llm_request nodes into
// semantically-labeled action/inference nodes. Fully deterministic: every label
// is derived from the injected SemanticsConfig (tool intent, path conventions,
// structural roles, harness markers). No model is involved.
//
// Enrichment is a pure per-node transform: by the time this stage runs, stage 5
// has already resolved the one piece of position-dependent data (the thread-
// relative request/response message deltas) onto each ExecutionNode, so a node's
// label depends only on its own fields. The hierarchy walk lives in
// `mapExecutionNodes`; this module only describes how to relabel a single node.
//
// A genuine terminal assistant message (final text, turn does not end in a tool
// call) is labeled with the generic `respond` act. Classifying that act more
// finely (answer / confirm / suggest …) is what a weak-model labeler did; it was
// removed for now. The `messageActs` vocabulary remains in the ontology, reserved
// for reintroducing it.
//
// Architecture constraint: this module is pure (no node:* imports).
// ════════════════════════════════════════════════════════════════════════════

// The ontology action used to label a genuine terminal assistant message.
const TERMINAL_MESSAGE_ACTION = 'respond';

function mechanicalLabel(node: GraphNode): readonly string[] {
  if (node.type === 'tool') return [node.name ?? 'tool'];
  if (node.type === 'llm_request') return [node.model];
  return [node.type];
}

/** The ordered action phrases for an inference, derived from the node's own
 *  thread-relative deltas. Falls back to the model id when there is no message
 *  delta to read. */
function inferenceLabel(
  node: ExecutionNode,
  canonical: LlmRequestNode,
  config: SemanticsConfig,
): readonly string[] {
  const response = node.responseMessagesDelta ?? [];
  const marker = markerLabel(config, node.requestMessagesDelta ?? [], response);
  if (marker != null) return marker;
  const prefix = structuralPrefix(config, response);
  // A terminal message is final text that does not precede a tool call. Text that
  // precedes a tool call is preamble to the action, not a terminal message.
  const isTerminalMessage = responseText(response) != null && responseToolCall(response) == null;
  if (isTerminalMessage) return [...prefix, actionLabel(config, TERMINAL_MESSAGE_ACTION)];
  if (prefix.length > 0) return prefix;
  return mechanicalLabel(canonical);
}

function enrichNode(node: ExecutionNode, config: SemanticsConfig): ExecutionNode {
  const canonical = node.canonical;
  if (canonical.type === 'tool') {
    const input = parseToolInput(canonical.tool_input);
    const comment = toolComment(config, canonical.name, input);
    return {
      ...node,
      canonical: {
        ...canonical,
        type: 'action',
        what: toolPhrases(config, canonical.name, input),
        ...(comment != null ? { comment } : {}),
      },
    };
  }
  if (canonical.type === 'llm_request') {
    return {
      ...node,
      canonical: { ...canonical, type: 'inference', what: inferenceLabel(node, canonical, config) },
    };
  }
  return node;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Enriches an ExecutionGraph by converting mechanical tool/llm_request nodes into
 * semantically-labeled action/inference nodes. Pure and deterministic — every
 * label comes from the injected SemanticsConfig.
 *
 * The graph structure (hierarchy, ids, edges) is preserved exactly — only the
 * tool/llm_request node payloads change; all other node types pass through
 * unchanged.
 */
export function enrichExecutionGraph(
  graph: ExecutionGraph,
  config: SemanticsConfig,
): ExecutionGraph {
  return mapExecutionNodes(graph, (node) => enrichNode(node, config));
}
