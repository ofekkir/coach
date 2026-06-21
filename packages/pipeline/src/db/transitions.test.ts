import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../orchestrate.ts';
import type { CanonicalNode, UploadedFile } from '../types.ts';
import type { ExecutionGraph } from '../graph/types.ts';
import { buildTransitions } from './transitions.ts';
import { seqByNodeId } from './seq.ts';

const FIXTURES = join(import.meta.dirname, '../../fixtures');
const REFACTOR_JSONL = readFileSync(
  join(FIXTURES, 'native-claude/refactor-code/session.jsonl'),
  'utf8',
);

function graphOf(content: string): ExecutionGraph {
  const files: UploadedFile[] = [{ name: 'session.jsonl', content }];
  return runPipeline(files).enrichedGraph;
}

function toolNodesByInteraction(graph: ExecutionGraph): Map<string, CanonicalNode[]> {
  const groups = new Map<string, CanonicalNode[]>();
  for (const node of Object.values(graph.nodes)) {
    if (node.type !== 'tool' || node.interactionId == null) continue;
    const group = groups.get(node.interactionId) ?? [];
    group.push(node);
    groups.set(node.interactionId, group);
  }
  return groups;
}

// An independent LEAD()-style reference: order each interaction's tool nodes by
// seq, then pair each row with the NEXT row (the window function `LEAD`).
function leadPairs(ordered: readonly CanonicalNode[]): [CanonicalNode, CanonicalNode][] {
  const pairs: [CanonicalNode, CanonicalNode][] = [];
  let previous: CanonicalNode | undefined;
  for (const to of ordered) {
    if (previous != null) pairs.push([previous, to]);
    previous = to;
  }
  return pairs;
}

function referenceTransitions(graph: ExecutionGraph): Record<string, unknown>[] {
  const seq = seqByNodeId(Object.values(graph.nodes));
  return [...toolNodesByInteraction(graph)].flatMap(([interactionId, tools]) => {
    const ordered = [...tools].sort((a, b) => (seq.get(a.id) ?? 0) - (seq.get(b.id) ?? 0));
    return leadPairs(ordered).map(([from, to]) => ({
      interaction_id: interactionId,
      from_seq: seq.get(from.id),
      from_action: graph.actions[from.id] ?? 'other',
      to_action: graph.actions[to.id] ?? 'other',
    }));
  });
}

function multiset(rows: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = `${String(r.interaction_id)}|${String(r.from_seq)}|${String(r.from_action)}|${String(r.to_action)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

describe('transitions table', () => {
  it('emits exactly max(0, tool_count - 1) rows per interaction (never negative)', () => {
    const graph = graphOf(REFACTOR_JSONL);
    const rows = buildTransitions(graph);
    const byInteraction = new Map<string, number>();
    for (const r of rows) {
      const id = String(r.interaction_id);
      byInteraction.set(id, (byInteraction.get(id) ?? 0) + 1);
    }
    const toolCounts = toolNodesByInteraction(graph);
    expect(toolCounts.size).toBeGreaterThan(0);
    for (const [id, tools] of toolCounts) {
      expect(byInteraction.get(id) ?? 0).toBe(Math.max(0, tools.length - 1));
    }
  });

  it('matches a reference LEAD()-style window over seq-ordered tool nodes', () => {
    const graph = graphOf(REFACTOR_JSONL);
    expect(multiset(buildTransitions(graph))).toEqual(multiset(referenceTransitions(graph)));
  });

  it('reproduces explore→edit, edit→explore and edit→verify on the refactor fixture', () => {
    const rows = buildTransitions(graphOf(REFACTOR_JSONL));
    const pairs = rows.map((r) => `${String(r.from_action)}→${String(r.to_action)}`);
    expect(pairs).toContain('explore→edit');
    expect(pairs).toContain('edit→explore');
    expect(pairs).toContain('edit→verify');
  });

  it('emits no rows for an interaction with a single tool node', () => {
    const tool: CanonicalNode = {
      id: 't1',
      type: 'tool',
      name: 'Read',
      sessionId: 's',
      interactionId: 'i',
      start_time_ns: '0',
      end_time_ns: '1',
      duration_ms: 1,
    };
    const graph: ExecutionGraph = {
      kind: 'interaction',
      data: null,
      nodes: { [tool.id]: tool },
      deltas: {},
      semantics: {},
      actions: { t1: 'explore' },
      intents: {},
    };
    expect(buildTransitions(graph)).toEqual([]);
  });
});
