import type { CanonicalNode } from '../../types.ts';
import type {
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  InteractionSemantics,
  InteractionShape,
  Segment,
  SemanticGraph,
  SemanticNode,
} from '../types.ts';
import { actionVerbFromNode, inferenceMovesFromRawResponse } from './verbs.ts';

// ════════════════════════════════════════════════════════════════════════════
// Semantic graph builder — Coach's inferred layer as a PURE FUNCTION of the
// execution graph. It reuses the SAME ExecutionNode refs (structural sharing).
// ════════════════════════════════════════════════════════════════════════════

function isInference(node: ExecutionNode): boolean {
  return node.canonical.type === 'llm_request';
}

// V1: every step belongs to a single segment (index 0).
// Seam: replace with a boundary-detection pass over members' moves/verbs to
// detect goal shifts (e.g. thinking-topic change, end_turn followed by new
// reasoning), or delegate to an LLM classifier.
function assignSegments(members: readonly SemanticNode[]): number[] {
  return members.map(() => 0);
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

// Splits ordered members into contiguous groups. A group starts at each
// inference and extends over the action steps that follow it until the next
// inference. Actions before the first inference each form their own group.
function groupByInference(members: readonly ExecutionNode[]): ExecutionNode[][] {
  const groups: ExecutionNode[][] = [];
  let open: ExecutionNode[] | null = null;
  for (const member of members) {
    if (open != null && !isInference(member)) open.push(member);
    else open = appendGroup(groups, member);
  }
  return groups;
}

function appendGroup(groups: ExecutionNode[][], member: ExecutionNode): ExecutionNode[] | null {
  const group = [member];
  groups.push(group);
  return isInference(member) ? group : null;
}

// Within a thread's ordered members, an inference subsumes the contiguous action
// steps that follow it until the next inference. Leading actions with no
// preceding inference become their own node with empty moves.
function mergeInferenceWithActions(members: readonly ExecutionNode[]): SemanticNode[] {
  return groupByInference(members).map(toSemanticNode);
}

function toSemanticNode(execution: readonly ExecutionNode[]): SemanticNode {
  const head = execution[0];
  const inference = head != null && isInference(head) ? head : null;
  const actions = inference != null ? execution.slice(1) : execution;
  const moves =
    inference != null ? inferenceMovesFromRawResponse(inference.canonical.raw_response) : [];
  const actionVerbs = actions.map((a) =>
    actionVerbFromNode(a.canonical.name, a.canonical.tool_input),
  );
  const anchor = head ?? execution[0];

  return {
    id: `sem_${anchor?.id ?? 'unknown'}`,
    moves,
    actionVerbs,
    execution,
  };
}

// One Segment per distinct index, members in original order. With the all-zeros
// stub this yields a single segment.
// Seam: real sub-goal names will come from the classifier; the label is a
// placeholder ("segment 1") keyed to the index for now.
function buildSegments(members: readonly SemanticNode[]): Segment[] {
  const indices = assignSegments(members);
  const byIndex = new Map<number, SemanticNode[]>();

  members.forEach((member, i) => {
    const index = indices[i] ?? 0;
    const group = byIndex.get(index) ?? [];
    group.push(member);
    byIndex.set(index, group);
  });

  return [...byIndex.keys()]
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      label: `segment ${String(index + 1)}`,
      members: byIndex.get(index) ?? [],
    }));
}

function buildInteractionSemantics(interaction: InteractionExecution): InteractionSemantics {
  const allMembers = interaction.threads.flatMap((thread) => thread.members);
  const stepCanonicals = allMembers.map((member) => member.canonical);
  const semanticNodes = interaction.threads.flatMap((thread) =>
    mergeInferenceWithActions(thread.members),
  );

  return {
    interactionId: interaction.root.id,
    shape: deriveInteractionShape(stepCanonicals),
    segments: buildSegments(semanticNodes),
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
