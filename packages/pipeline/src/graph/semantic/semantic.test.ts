import { describe, expect, it } from 'vitest';
import type { CanonicalNode, NodeType } from '../../types.ts';
import type {
  ExecutionGraph,
  ExecutionNode,
  InteractionExecution,
  SemanticNode,
} from '../types.ts';
import { buildSemanticGraph } from './semantic.ts';

function executionNode(
  id: string,
  canonical: Partial<CanonicalNode> & { type: NodeType },
): ExecutionNode {
  return {
    id,
    canonical: { id, ...canonical },
    children: [],
    innerEdges: [],
  };
}

function inference(
  id: string,
  content: readonly { type: string }[],
  stopReason: string,
): ExecutionNode {
  return executionNode(id, {
    type: 'llm_request',
    raw_response: JSON.stringify({ content, stop_reason: stopReason }),
    stop_reason: stopReason,
  });
}

function action(id: string, name: string, toolInput: string): ExecutionNode {
  return executionNode(id, { type: 'tool', name, tool_input: toolInput });
}

function interactionGraph(
  interactionId: string,
  members: readonly ExecutionNode[],
): ExecutionGraph {
  const data: InteractionExecution = {
    root: executionNode(interactionId, { type: 'interaction' }),
    threads: [{ id: 'thread_main', source: 'main', members, edges: [] }],
    rootToThreadIds: ['thread_main'],
  };
  return { kind: 'interaction', data };
}

function verbsOf(node: SemanticNode): string[] {
  return node.moves.map((m) => m.verb);
}

function defined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

describe('buildSemanticGraph', () => {
  it('merges a reason+act inference with the following action into one node', () => {
    const reasonAct = inference('inf1', [{ type: 'thinking' }, { type: 'tool_use' }], 'tool_use');
    const edit = action('act1', 'Edit', 'some/path');
    const answer = inference('inf2', [{ type: 'text' }], 'end_turn');
    const graph = interactionGraph('int1', [reasonAct, edit, answer]);

    const result = buildSemanticGraph(graph);

    expect(result.interactions).toHaveLength(1);
    const semantics = defined(result.interactions[0]);
    expect(semantics.interactionId).toBe('int1');
    expect(semantics.shape).toBe('agentic');
    expect(semantics.segments).toHaveLength(1);

    const members = defined(semantics.segments[0]).members;
    expect(members).toHaveLength(2);

    const merged = defined(members[0]);
    expect(verbsOf(merged)).toContain('reason');
    expect(verbsOf(merged)).toContain('act');
    expect(merged.actionVerbs).toContain('Edit');
    expect(merged.execution).toEqual([reasonAct, edit]);

    const trailing = defined(members[1]);
    expect(trailing.actionVerbs).toEqual([]);
    expect(trailing.execution).toEqual([answer]);
  });

  it('derives query shape for a single end_turn inference with no tools', () => {
    const answer = inference('inf1', [{ type: 'text' }], 'end_turn');
    const graph = interactionGraph('int-query', [answer]);

    const result = buildSemanticGraph(graph);

    expect(result.interactions[0]?.shape).toBe('query');
  });
});
