import { describe, expect, it } from 'vitest';
import type { CanonicalNode, NodeType } from '../../types.ts';
import type { ExecutionGraph, ExecutionNode, InteractionExecution, Step } from '../types.ts';
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

function verbsOf(step: Step): string[] {
  return step.moves.map((m) => m.verb);
}

function defined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

describe('buildSemanticGraph', () => {
  it('emits one step per execution node (no merging of inference and action)', () => {
    const reasonAct = inference('inf1', [{ type: 'thinking' }, { type: 'tool_use' }], 'tool_use');
    const edit = action('act1', 'Edit', 'some/path');
    const answer = inference('inf2', [{ type: 'text' }], 'end_turn');
    const graph = interactionGraph('int1', [reasonAct, edit, answer]);

    const result = buildSemanticGraph(graph);

    expect(result.interactions).toHaveLength(1);
    const semantics = defined(result.interactions[0]);
    expect(semantics.interactionId).toBe('int1');
    expect(semantics.shape).toBe('agentic');
    expect(semantics.threads).toHaveLength(1);
    expect(defined(semantics.threads[0]).segments).toHaveLength(1);

    const steps = defined(defined(semantics.threads[0]).segments[0]).steps;
    expect(steps).toHaveLength(3);

    const infStep = defined(steps[0]);
    expect(infStep.kind).toBe('inference');
    expect(verbsOf(infStep)).toContain('reason');
    expect(verbsOf(infStep)).toContain('act');
    expect(infStep.execution).toBe(reasonAct);

    const actStep = defined(steps[1]);
    expect(actStep.kind).toBe('action');
    expect(actStep.verb).toBe('Edit');
    expect(actStep.moves).toEqual([]);
    expect(actStep.execution).toBe(edit);
  });

  it('segments per thread, preserving threading instead of merging lanes', () => {
    const thread = (source: string, members: ExecutionNode[]) => ({
      id: `thread_${source}`,
      source,
      members,
      edges: [],
    });
    const main = thread('repl_main_thread', [inference('llmA', [{ type: 'text' }], 'tool_use')]);
    const title = thread('generate_session_title', [
      inference('titleLlm', [{ type: 'text' }], 'end_turn'),
    ]);
    const data: InteractionExecution = {
      root: executionNode('int1', { type: 'interaction' }),
      threads: [main, title],
      rootToThreadIds: [main.id, title.id],
    };

    const result = buildSemanticGraph({ kind: 'interaction', data });

    const threads = defined(result.interactions[0]).threads;
    expect(threads.map((t) => t.source)).toEqual(['repl_main_thread', 'generate_session_title']);
    expect(threads.every((t) => t.segments.length >= 1)).toBe(true);
    expect(threads.every((t) => t.segments.every((s) => s.steps.length >= 1))).toBe(true);
  });

  it('derives query shape for a single end_turn inference with no tools', () => {
    const answer = inference('inf1', [{ type: 'text' }], 'end_turn');
    const graph = interactionGraph('int-query', [answer]);

    const result = buildSemanticGraph(graph);

    expect(result.interactions[0]?.shape).toBe('query');
  });
});
