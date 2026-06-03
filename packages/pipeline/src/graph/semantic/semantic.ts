import type { CanonicalNode } from '../../types.ts';
import type {
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  InteractionSemantics,
  InteractionShape,
  Segment,
  SemanticGraph,
  Step,
  Thread,
  ThreadSemantics,
} from '../types.ts';
import { actionVerbFromNode, inferenceMovesFromRawResponse } from './verbs.ts';

// ════════════════════════════════════════════════════════════════════════════
// Semantic graph builder — Coach's inferred layer as a PURE FUNCTION of the
// execution graph. Each execution step (inference|action) becomes one semantic
// Step (~1:1 with an execution node, reusing the SAME ref); steps are grouped
// into segments (sub-goals). A segment always holds at least one step.
// ════════════════════════════════════════════════════════════════════════════

function isInference(node: ExecutionNode): boolean {
  return node.canonical.type === 'llm_request';
}

function toStep(member: ExecutionNode): Step {
  if (isInference(member)) {
    return {
      id: member.id,
      kind: 'inference',
      moves: inferenceMovesFromRawResponse(member.canonical.raw_response),
      execution: member,
    };
  }
  return {
    id: member.id,
    kind: 'action',
    moves: [],
    verb: actionVerbFromNode(member.canonical.name, member.canonical.tool_input),
    execution: member,
  };
}

function nsStart(node: ExecutionNode): bigint {
  return node.canonical.start_time_ns != null ? BigInt(node.canonical.start_time_ns) : 0n;
}

function byStart(a: ExecutionNode, b: ExecutionNode): number {
  const diff = nsStart(a) - nsStart(b);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

// Segmentation runs per thread (V1): a thread's steps are its members in time
// order, grouped into segments. Threading is preserved — segments do not merge
// or cross-cut threads for now.
function threadSteps(thread: Thread): Step[] {
  return [...thread.members].sort(byStart).map(toStep);
}

// V1: every step belongs to a single segment (index 0).
// Seam: replace with a boundary-detection pass over steps' moves/verbs to detect
// goal shifts (e.g. thinking-topic change, end_turn followed by new reasoning),
// or delegate to an LLM classifier.
function assignSegments(steps: readonly Step[]): number[] {
  return steps.map(() => 0);
}

// One Segment per distinct index, steps in order. Empty groups are never emitted,
// so the >= 1 step invariant holds. With the all-zeros stub this is one segment.
// Seam: real sub-goal names will come from the classifier; the label is a
// placeholder ("segment 1") keyed to the index for now.
function buildSegments(steps: readonly Step[]): Segment[] {
  const indices = assignSegments(steps);
  const byIndex = new Map<number, Step[]>();

  steps.forEach((step, i) => {
    const index = indices[i] ?? 0;
    const group = byIndex.get(index) ?? [];
    group.push(step);
    byIndex.set(index, group);
  });

  return [...byIndex.keys()]
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      label: `segment ${String(index + 1)}`,
      steps: byIndex.get(index) ?? [],
    }));
}

// query: exactly one inference, end_turn, no tools. Otherwise agentic.
function deriveInteractionShape(stepCanonicals: readonly CanonicalNode[]): InteractionShape {
  const llms = stepCanonicals.filter((n) => n.type === 'llm_request');
  const tools = stepCanonicals.filter((n) => n.type === 'tool');
  if (llms.length === 1 && tools.length === 0 && llms[0]?.stop_reason === 'end_turn') {
    return 'query';
  }
  return 'agentic';
}

function buildThreadSemantics(thread: Thread): ThreadSemantics {
  return { id: thread.id, source: thread.source, segments: buildSegments(threadSteps(thread)) };
}

function buildInteractionSemantics(interaction: InteractionExecution): InteractionSemantics {
  const stepCanonicals = interaction.threads.flatMap((thread) =>
    thread.members.map((member) => member.canonical),
  );
  return {
    interactionId: interaction.root.id,
    shape: deriveInteractionShape(stepCanonicals),
    threads: interaction.threads
      .map(buildThreadSemantics)
      .filter((thread) => thread.segments.length > 0),
  };
}

function interactionsFromGraph(execution: ExecutionGraph): readonly InteractionExecution[] {
  if (execution.kind === 'agent') {
    return execution.data.sessions.flatMap((session) => session.interactions);
  }
  if (execution.kind === 'session') {
    return execution.data.interactions;
  }
  return execution.data != null ? [execution.data] : [];
}

export function buildSemanticGraph(execution: ExecutionGraph): SemanticGraph {
  return {
    interactions: interactionsFromGraph(execution).map(buildInteractionSemantics),
  };
}
