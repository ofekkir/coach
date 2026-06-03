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

function nsEnd(node: ExecutionNode): bigint {
  return node.canonical.end_time_ns != null ? BigInt(node.canonical.end_time_ns) : nsStart(node);
}

function byStart(a: ExecutionNode, b: ExecutionNode): number {
  const diff = nsStart(a) - nsStart(b);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

function sortedMembers(thread: Thread): ExecutionNode[] {
  return [...thread.members].sort(byStart);
}

function threadStart(thread: Thread): bigint {
  return thread.members.reduce(
    (min, m) => (nsStart(m) < min ? nsStart(m) : min),
    thread.members[0] != null ? nsStart(thread.members[0]) : 0n,
  );
}

function byThreadStart(a: Thread, b: Thread): number {
  const diff = threadStart(a) - threadStart(b);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

function pickMainThread(threads: readonly Thread[]): Thread | null {
  const main = threads.find((t) => t.source === 'repl_main_thread');
  if (main != null) return main;
  return [...threads].sort(byThreadStart)[0] ?? null;
}

// A sub-thread (sub-agent loop) is spawned by a Task action and runs to
// completion inside that action's execution window — so it belongs to the action
// whose [start, end] contains the sub-thread's start. Only actions spawn threads.
function actionOwns(member: ExecutionNode, sub: Thread): boolean {
  if (member.canonical.type !== 'tool') return false;
  const subStart = threadStart(sub);
  return nsStart(member) <= subStart && subStart <= nsEnd(member);
}

// Emits a member, then splices in the steps of any sub-threads it spawned —
// keeping each sub-thread contiguous (segment ⊇ sub-thread) instead of
// interleaving threads by global time. Recurses for nested sub-agents.
function emitMember(member: ExecutionNode, remaining: Set<Thread>, out: ExecutionNode[]): void {
  out.push(member);
  const owned = [...remaining].filter((sub) => actionOwns(member, sub)).sort(byThreadStart);
  for (const sub of owned) {
    remaining.delete(sub);
    for (const subMember of sortedMembers(sub)) emitMember(subMember, remaining, out);
  }
}

// Walks the main thread in order, grouping each sub-thread under its spawning
// action; sub-threads with no owning action (e.g. side-calls) append in order.
function orderInteractionMembers(interaction: InteractionExecution): ExecutionNode[] {
  const main = pickMainThread(interaction.threads);
  if (main == null) return [];

  const remaining = new Set(interaction.threads.filter((thread) => thread !== main));
  const out: ExecutionNode[] = [];
  for (const member of sortedMembers(main)) emitMember(member, remaining, out);

  for (const sub of [...remaining].sort(byThreadStart)) out.push(...sortedMembers(sub));
  return out;
}

function orderedSteps(interaction: InteractionExecution): Step[] {
  return orderInteractionMembers(interaction).map(toStep);
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

function buildInteractionSemantics(interaction: InteractionExecution): InteractionSemantics {
  const steps = orderedSteps(interaction);
  return {
    interactionId: interaction.root.id,
    shape: deriveInteractionShape(steps.map((step) => step.execution.canonical)),
    segments: buildSegments(steps),
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
