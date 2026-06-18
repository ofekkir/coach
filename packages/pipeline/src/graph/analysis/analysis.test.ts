import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../../orchestrate.ts';
import type { UploadedFile } from '../../types.ts';
import { analyzeGraph } from './analysis.ts';

const FIXTURES = join(import.meta.dirname, '../../../fixtures');

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURES, relPath), 'utf8');
}

const NATIVE_JSONL = readFixture('native-claude/fetch-website/session.jsonl');

describe('analyzeGraph', () => {
  const files: UploadedFile[] = [{ name: 'session.jsonl', content: NATIVE_JSONL }];
  const { enrichedGraph, analysis } = runPipeline(files);

  it('is computable from the enriched graph alone (no pipeline state)', () => {
    expect(analyzeGraph(enrichedGraph)).toEqual(analysis);
  });

  it('mirrors the graph level and produces at least one session with interactions', () => {
    expect(analysis.kind).toBe('agent');
    expect(analysis.sessions.length).toBeGreaterThan(0);
    const interactions = analysis.sessions.flatMap((s) => s.interactions);
    expect(interactions.length).toBeGreaterThan(0);
  });

  it('classifies every interaction and rolls cost/tokens up consistently', () => {
    const interactions = analysis.sessions.flatMap((s) => s.interactions);
    for (const i of interactions) {
      expect(['query', 'agentic']).toContain(i.shape);
      expect(i.rollup.costUsd).toBeGreaterThanOrEqual(0);
      expect(i.rollup.llmCalls).toBeGreaterThanOrEqual(0);
    }
    const agentCost = analysis.rollup.costUsd;
    const summed = analysis.sessions.reduce((acc, s) => acc + s.rollup.costUsd, 0);
    expect(agentCost).toBeCloseTo(summed);
  });

  it('reports the failed-tool-call coverage gap honestly', () => {
    expect(analysis.gaps.length).toBeGreaterThan(0);
    const interactions = analysis.sessions.flatMap((s) => s.interactions);
    expect(interactions.every((i) => i.failures.length === 0)).toBe(true);
  });
});
