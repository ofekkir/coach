import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../orchestrate.ts';
import type { UploadedFile } from '../types.ts';
import { buildRecords, materializeSql } from './materialize.ts';

const FIXTURES = join(import.meta.dirname, '../../fixtures');
const REFACTOR_JSONL = readFileSync(
  join(FIXTURES, 'native-claude/refactor-code/session.jsonl'),
  'utf8',
);

function records() {
  const files: UploadedFile[] = [{ name: 'session.jsonl', content: REFACTOR_JSONL }];
  const { enrichedGraph } = runPipeline(files);
  return buildRecords(enrichedGraph);
}

function nodesOf(
  nodes: Record<string, unknown>[],
  interactionId: unknown,
): Record<string, unknown>[] {
  return nodes.filter((n) => n.interaction_id === interactionId);
}

function distinctFilePaths(toolNodes: Record<string, unknown>[]): number {
  const paths = toolNodes.map((n) => n.file_path).filter((p): p is string => typeof p === 'string');
  return new Set(paths).size;
}

function sumLlm(llmNodes: Record<string, unknown>[], field: string): number {
  return llmNodes.reduce((t, n) => {
    const value = n[field];
    return t + (typeof value === 'number' ? value : 0);
  }, 0);
}

function assertRowEqualsAggregate(
  row: Record<string, unknown>,
  ownNodes: Record<string, unknown>[],
): void {
  const interaction = ownNodes.find((n) => n.type === 'interaction');
  const prompt = interaction?.prompt;
  const toolNodes = ownNodes.filter((n) => n.type === 'tool');
  const llmNodes = ownNodes.filter((n) => n.type === 'llm_request');
  const bySeq = [...toolNodes].sort((a, b) => Number(a.seq) - Number(b.seq));

  expect(row.session_id).toBe(interaction?.session_id);
  expect(row.sequence).toBe(interaction?.sequence);
  expect(row.prompt_len).toBe(typeof prompt === 'string' ? prompt.length : undefined);
  expect(row.tool_count).toBe(toolNodes.length);
  expect(row.llm_count).toBe(llmNodes.length);
  expect(row.tokens_in).toBe(sumLlm(llmNodes, 'tokens_in'));
  expect(row.tokens_out).toBe(sumLlm(llmNodes, 'tokens_out'));
  expect(row.cost_usd).toBe(sumLlm(llmNodes, 'cost_usd'));
  expect(row.duration_ms).toBe(interaction?.duration_ms);
  expect(row.distinct_files).toBe(distinctFilePaths(toolNodes));
  expect(row.error_count).toBe(toolNodes.filter((n) => n.is_error === true).length);
  expect(row.first_action).toBe(bySeq[0]?.action);
  expect(row.last_action).toBe(bySeq[bySeq.length - 1]?.action);
  expect(row.shape).toBe(toolNodes.length > 0 ? 'agentic' : 'direct');
  expect(row.shape === 'agentic').toBe(Number(row.tool_count) > 0);
}

describe('interaction_metrics equality invariant', () => {
  it('every metric equals the direct aggregate over the interaction nodes', () => {
    const { nodes = [], interaction_metrics = [] } = records();
    expect(interaction_metrics.length).toBeGreaterThan(0);
    for (const row of interaction_metrics)
      assertRowEqualsAggregate(row, nodesOf(nodes, row.interaction_id));
  });

  it('exposes one row per interaction node', () => {
    const { nodes = [], interaction_metrics = [] } = records();
    const interactionIds = new Set(nodes.filter((n) => n.type === 'interaction').map((n) => n.id));
    expect(interaction_metrics.length).toBe(interactionIds.size);
    for (const row of interaction_metrics) {
      expect(interactionIds.has(row.interaction_id)).toBe(true);
    }
  });

  it('declares the interaction_metrics table and shape column in the DDL', () => {
    const files: UploadedFile[] = [{ name: 'session.jsonl', content: REFACTOR_JSONL }];
    const { enrichedGraph } = runPipeline(files);
    const sql = materializeSql(enrichedGraph);
    expect(sql.some((s) => s.includes('CREATE TABLE interaction_metrics'))).toBe(true);
    expect(sql.some((s) => s.includes('shape VARCHAR'))).toBe(true);
  });
});
