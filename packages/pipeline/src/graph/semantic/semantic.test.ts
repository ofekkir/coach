import { defaultSemanticsConfig } from '@coach/semantics';
import { describe, expect, it } from 'vitest';

import { aggregate } from '../../aggregate/aggregate.ts';
import type { CanonicalNode } from '../../types.ts';
import { sessionEntityId } from '../../types.ts';
import { buildExecutionGraph } from '../execution/execution.ts';
import type { ExecutionGraph } from '../types.ts';
import { nodeData, semanticsOf } from '../types.ts';

import { enrichExecutionGraph } from './semantic.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SID = sessionEntityId('s-1');

const interaction: CanonicalNode = {
  id: 'inter',
  type: 'interaction',
  sessionId: SID,
  session_id: 's-1',
  user_id: 'u-1',
  sequence: 0,
  prompt: 'do something',
  start_time_ns: '90000000',
  end_time_ns: '500000000',
  duration_ms: 410,
};
const llm1: CanonicalNode = {
  id: 'llm1',
  type: 'llm_request',
  parent: 'inter',
  sessionId: SID,
  source: 'repl_main_thread',
  model: 'claude-haiku',
  request_messages: [{ role: 'user', content: 'What should I do next?' }],
  response_messages: [{ type: 'text', text: 'You should run the tests.' }],
  tokens_in: 100,
  tokens_out: 20,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  start_time_ns: '100000000',
  end_time_ns: '200000000',
  duration_ms: 100,
};
const tool1: CanonicalNode = {
  id: 'tool1',
  type: 'tool',
  parent: 'inter',
  sessionId: SID,
  name: 'Bash',
  // real traces carry JSON tool_input; `description` is the agent's own intent annotation
  tool_input: '{"command":"pnpm test","description":"Run the test suite"}',
  start_time_ns: '210000000',
  end_time_ns: '300000000',
  duration_ms: 90,
};

function buildGraph(nodes: CanonicalNode[]): ExecutionGraph {
  return buildExecutionGraph(aggregate([nodes]));
}

function enrich(nodes: CanonicalNode[]): ExecutionGraph {
  return enrichExecutionGraph(buildGraph(nodes), defaultSemanticsConfig);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('enrichExecutionGraph', () => {
  it('writes a semantics row per relabeled node, keyed by id', () => {
    const enriched = enrich([interaction, llm1, tool1]);
    // The final text turn (no trailing tool call) gets the generic deterministic
    // respond act — no model classifies it more finely.
    expect(semanticsOf(enriched, 'llm1')).toEqual({ what: ['respond'] });
    // `what` is the command verb resolved via the ontology command grammar
    // (`pnpm test` → run tests), not the literal tool name; `comment` is the
    // agent's verbatim description.
    expect(semanticsOf(enriched, 'tool1')).toEqual({
      what: ['run tests'],
      comment: 'Run the test suite',
    });
  });

  it('promotes structured context onto the semantics row the app renders', () => {
    const readNode: CanonicalNode = {
      ...tool1,
      id: 'read1',
      name: 'Read',
      tool_input: JSON.stringify({ file_path: 'packages/app/src/main.tsx' }),
    };
    const enriched = enrich([interaction, llm1, readNode]);
    expect(semanticsOf(enriched, 'read1')).toEqual({
      what: ['read source code'],
      context: { package: 'app', file: 'packages/app/src/main.tsx' },
    });
  });

  it('derives escape-hatch (Bash) `what` from the command grammar, not the tool name', () => {
    const bashNode = (id: string, command: string): CanonicalNode => ({
      ...tool1,
      id,
      tool_input: JSON.stringify({ command }),
    });
    const enriched = enrich([
      interaction,
      llm1,
      bashNode('test1', 'pnpm test --filter pipeline'),
      bashNode('git1', 'git commit -m "x"'),
      bashNode('grep1', 'grep -rn foo src/'),
    ]);
    expect(semanticsOf(enriched, 'test1')?.what).toEqual(['run tests']);
    expect(semanticsOf(enriched, 'git1')?.what).toEqual(['version control']);
    expect(semanticsOf(enriched, 'grep1')?.what).toEqual(['search']);
  });

  it('qualifies an unclassified command with the invoked program (not bare run)', () => {
    const node: CanonicalNode = {
      ...tool1,
      id: 'run1',
      tool_input: JSON.stringify({ command: 'python3 scripts/build.py' }),
    };
    const enriched = enrich([interaction, llm1, node]);
    expect(semanticsOf(enriched, 'run1')?.what).toEqual(['run python3']);
  });

  it('derives a closed action for every tool node (here: pnpm test → test)', () => {
    const enriched = enrich([interaction, llm1, tool1]);
    expect(enriched.actions.tool1).toBe('test');
    // non-tool nodes get no action row
    expect(enriched.actions.llm1).toBeUndefined();
    expect(enriched.actions.inter).toBeUndefined();
  });

  it('leaves the non-relabeled interaction node without a semantics row', () => {
    const enriched = enrich([interaction, llm1, tool1]);
    expect(semanticsOf(enriched, 'inter')).toBeUndefined();
  });

  it('preserves the node table, deltas, and edges unchanged (only semantics is built)', () => {
    const base = buildGraph([interaction, llm1, tool1]);
    const enriched = enrichExecutionGraph(base, defaultSemanticsConfig);
    expect(enriched.nodes).toBe(base.nodes);
    expect(enriched.deltas).toBe(base.deltas);
    if (enriched.kind !== 'agent') throw new Error('expected agent');
    const ix = enriched.data.sessions[0]?.interactions[0];
    expect(ix?.interactionId).toBe('inter');
    // node data is untouched by enrichment
    expect(nodeData(enriched, 'llm1')).toMatchObject({
      tokens_in: 100,
      tokens_out: 20,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      model: 'claude-haiku',
    });
  });

  it('produces an empty semantics table when there are no tool/llm_request nodes', () => {
    const enriched = enrich([interaction]);
    expect(Object.keys(enriched.semantics)).toHaveLength(0);
  });

  it('labels session-title calls deterministically (marker short-circuit)', () => {
    const titleLlm: CanonicalNode = {
      ...llm1,
      id: 'title1',
      request_messages: [{ role: 'user', content: '<session>\nadd an mcp\n</session>' }],
      response_messages: [{ type: 'text', text: '{"title": "Add Grafana MCP server"}' }],
    };
    const enriched = enrich([interaction, titleLlm]);
    expect(semanticsOf(enriched, 'title1')).toEqual({ what: ['generate session title'] });
  });

  it('labels nodes with no message delta with the model-id fallback', () => {
    const emptyLlm: CanonicalNode = {
      id: 'empty1',
      type: 'llm_request',
      parent: 'inter',
      sessionId: SID,
      source: 'repl_main_thread',
      model: 'claude-haiku',
      tokens_in: 100,
      tokens_out: 20,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      start_time_ns: '100000000',
      end_time_ns: '200000000',
      duration_ms: 100,
    };
    const enriched = enrich([interaction, emptyLlm]);
    expect(semanticsOf(enriched, 'empty1')).toEqual({ what: ['claude-haiku'] });
  });
});
