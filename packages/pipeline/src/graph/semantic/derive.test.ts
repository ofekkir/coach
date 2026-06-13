import { describe, expect, it } from 'vitest';
import { testConfig } from './config.fixture.ts';
import { hasThinking, invokePhrase, markerLabel, responseText } from './derive.ts';
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

  it('splits WebFetch into fetch + summarize when the prompt asks to summarize', () => {
    expect(
      toolPhrases(testConfig, 'WebFetch', {
        url: 'https://www.ynet.co.il',
        prompt: 'Summarize the headlines',
      }),
    ).toEqual(['fetch ynet.co.il', 'summarize content']);
  });

  it('reads the selected tool out of a ToolSearch query via the extract regex', () => {
    expect(
      toolPhrases(testConfig, 'ToolSearch', { query: 'select:WebFetch', max_results: 5 }),
    ).toEqual(['load WebFetch tool schema']);
  });

  it('applies the Skill override to name the skill intent', () => {
    expect(toolPhrases(testConfig, 'Skill', { skill: 'update-config', args: '...' })).toEqual([
      'update claude code config',
    ]);
  });

  it('falls back to the lowercased tool name for unknown tools', () => {
    expect(toolPhrases(testConfig, 'SomeTool', {})).toEqual(['sometool']);
  });
});

describe('invokePhrase (config-driven)', () => {
  it('uses the Skill structural-role override', () => {
    expect(invokePhrase(testConfig, { name: 'Skill', input: { skill: 'update-config' } })).toBe(
      'decide on skill use',
    );
  });

  it('prefixes the derived tool intent with "invoke"', () => {
    expect(
      invokePhrase(testConfig, {
        name: 'Read',
        input: { file_path: '/Users/x/.claude/settings.json' },
      }),
    ).toBe('invoke read claude code user settings');
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

describe('structural detectors (content-shape, not config-driven)', () => {
  it('flags a thinking block', () => {
    expect(hasThinking([{ type: 'thinking', thinking: '<REDACTED>' }])).toBe(true);
    expect(hasThinking([{ type: 'text', text: 'hi' }])).toBe(false);
  });

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
