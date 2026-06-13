import { describe, expect, it } from 'vitest';
import { testConfig } from './config.fixture.ts';
import { markerLabel, responseText, structuralPrefix } from './derive.ts';
import { toolPhrases } from './tool-intent.ts';

describe('toolPhrases (config-driven)', () => {
  it('derives read intent and the agent well-known path label, not the tool name', () => {
    expect(
      toolPhrases(testConfig, 'Read', { file_path: '/Users/x/.claude/settings.json' }),
    ).toEqual(['read claude code user settings']);
  });

  it('maps Edit to an edit intent on the same well-known object', () => {
    expect(
      toolPhrases(testConfig, 'Edit', { file_path: '/Users/x/.claude/settings.json' }),
    ).toEqual(['edit claude code user settings']);
  });

  it('renders "Both": basename + grounded ontology object type for a project path', () => {
    expect(
      toolPhrases(testConfig, 'Edit', {
        file_path: 'packages/pipeline/src/graph/semantic/derive.ts',
      }),
    ).toEqual(['edit derive.ts (business logic)']);
  });

  it('fetches + notes weak-model processing when WebFetch carries a prompt', () => {
    expect(
      toolPhrases(testConfig, 'WebFetch', {
        url: 'https://www.ynet.co.il',
        prompt: 'Summarize the headlines',
      }),
    ).toEqual(['fetch ynet.co.il', 'process result with weak model']);
  });

  it('reads the selected tool out of a ToolSearch query via the extract regex', () => {
    expect(
      toolPhrases(testConfig, 'ToolSearch', { query: 'select:WebFetch', max_results: 5 }),
    ).toEqual(['load WebFetch tool schema']);
  });

  it('names the skill intent from the skill field', () => {
    expect(toolPhrases(testConfig, 'Skill', { skill: 'update-config', args: '...' })).toEqual([
      'use update-config skill',
    ]);
  });

  it('falls back to the lowercased tool name for unknown tools', () => {
    expect(toolPhrases(testConfig, 'SomeTool', {})).toEqual(['sometool']);
  });
});

describe('structuralPrefix (config-driven roles)', () => {
  it('uses the tool_use rule override for a Skill call', () => {
    expect(
      structuralPrefix(testConfig, [{ type: 'tool_use', name: 'Skill', input: { skill: 'x' } }]),
    ).toEqual(['decide on skill use']);
  });

  it('emits thinking → plan then the derived tool intent for a trailing tool call', () => {
    expect(
      structuralPrefix(testConfig, [
        { type: 'thinking', thinking: '<REDACTED>' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/Users/x/.claude/settings.json' } },
      ]),
    ).toEqual(['plan next steps', 'invoke read claude code user settings']);
  });

  it('emits nothing for a plain terminal text message', () => {
    expect(structuralPrefix(testConfig, [{ type: 'text', text: 'all done' }])).toEqual([]);
  });
});

describe('markerLabel (config-driven harness markers)', () => {
  it('labels a session-title JSON response from the responseJsonHasStringKey rule', () => {
    expect(
      markerLabel(testConfig, [], [{ type: 'text', text: '{"title": "Add Grafana MCP server"}' }]),
    ).toEqual(['generate session title']);
  });

  it('labels suggestion mode from the requestTextStartsWith rule', () => {
    expect(
      markerLabel(testConfig, [{ role: 'user', content: '[SUGGESTION MODE: predict next]' }], []),
    ).toEqual(['predict next user prompt']);
  });

  it('returns undefined when no marker matches', () => {
    expect(
      markerLabel(testConfig, [{ role: 'user', content: 'hi' }], [{ type: 'text', text: 'ok' }]),
    ).toBeUndefined();
  });
});

describe('responseText (content-shape, not config-driven)', () => {
  it('returns the first non-empty text block, skipping thinking', () => {
    expect(
      responseText([
        { type: 'thinking', thinking: '<REDACTED>' },
        { type: 'text', text: 'the answer' },
      ]),
    ).toBe('the answer');
    expect(responseText([{ type: 'thinking', thinking: '<REDACTED>' }])).toBeUndefined();
  });
});
