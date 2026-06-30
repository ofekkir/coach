import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExecutionGraph } from './graph/types.ts';
import { runPipeline } from './orchestrate.ts';
import type { UploadedFile } from './types.ts';

const FIXTURES = join(import.meta.dirname, '../fixtures');

function loadFixtureDir(relDir: string): UploadedFile[] {
  const dir = join(FIXTURES, relDir);
  return readdirSync(dir).map((name) => ({
    name,
    content: readFileSync(join(dir, name), 'utf8'),
    path: join(relDir, name),
  }));
}

const FIXTURE_DIRS = [
  'native-claude/fetch-website',
  'native-claude/multi-turn',
  'native-claude/refactor-code',
  'otel/fetch-website',
  'otel/multi-turn-session',
  'otel/update-claude-config',
];

describe('pipeline e2e', () => {
  it.each(FIXTURE_DIRS)('%s — runs without throwing', (dir) => {
    const files = loadFixtureDir(dir);
    expect(() => runPipeline(files)).not.toThrow();
  });

  // Guards the full tool_use_id plumbing → causal builder for BOTH input formats:
  // native (span attr stamped by the native builder) and OTEL (attr enriched onto
  // the tool span from its decision log). A session with tool calls must yield
  // causal edges either way — this is the harness-agnostic promise.
  // `action` label invariant: every tool node gets a non-NULL action label, and the
  // per-label counts are identical across two runs of the same fixture (the
  // derivation is pure — no model, no nondeterminism).
  it('otel/fetch-website — every tool node has an action label; counts are deterministic', () => {
    const files = loadFixtureDir('otel/fetch-website');
    const first = runPipeline(files).resolvedGraph;
    const second = runPipeline(files).resolvedGraph;

    const toolIds = toolNodeIds(first);
    expect(toolIds.length).toBeGreaterThan(0);
    expect(toolIds.every((id) => toolAction(first, id) != null)).toBe(true);
    expect(actionCounts(first)).toEqual(actionCounts(second));
  });

  it.each(['native-claude/refactor-code', 'otel/update-claude-config'])(
    '%s — derives causal edges end-to-end',
    (dir) => {
      const graph = runPipeline(loadFixtureDir(dir)).enrichedGraph;
      if (graph.kind !== 'agent') throw new Error('expected agent graph');
      const causal = graph.data.sessions.flatMap((s) =>
        s.interactions.flatMap((i) => i.causalEdges),
      );
      expect(causal.length).toBeGreaterThan(0);
      expect(causal.every((e) => e.fromId !== e.toId)).toBe(true);
    },
  );
});

function toolNodeIds(graph: ExecutionGraph): string[] {
  return Object.values(graph.nodes)
    .filter((node) => node.type === 'tool')
    .map((node) => node.id);
}

// A tool node is single-entry, so its action label is its entry[0].action.
function toolAction(graph: ExecutionGraph, id: string): string | undefined {
  return graph.semantics[id]?.entries[0]?.action;
}

function actionCounts(graph: ExecutionGraph): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of toolNodeIds(graph)) {
    const action = toolAction(graph, id) ?? 'other';
    counts[action] = (counts[action] ?? 0) + 1;
  }
  return counts;
}
