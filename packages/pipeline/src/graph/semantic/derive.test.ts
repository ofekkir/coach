import { describe, expect, it } from 'vitest';
import {
  hasThinking,
  invokePhrase,
  isSessionTitleResponse,
  isSuggestionMode,
  responseText,
  toolPhrases,
} from './derive.ts';

describe('toolPhrases', () => {
  it('derives read intent from a .claude settings path, not the tool name', () => {
    expect(toolPhrases('Read', { file_path: '/Users/x/.claude/settings.json' })).toEqual([
      'read claude code user settings',
    ]);
  });

  it('maps Edit/Write to an edit intent on the same object', () => {
    expect(toolPhrases('Edit', { file_path: '/Users/x/.claude/settings.json' })).toEqual([
      'edit claude code user settings',
    ]);
  });

  it('splits WebFetch into fetch + summarize when the prompt asks to summarize', () => {
    expect(
      toolPhrases('WebFetch', { url: 'https://www.ynet.co.il', prompt: 'Summarize the headlines' }),
    ).toEqual(['fetch ynet.co.il', 'summarize content']);
  });

  it('reads the selected tool out of a ToolSearch query', () => {
    expect(toolPhrases('ToolSearch', { query: 'select:WebFetch', max_results: 5 })).toEqual([
      'load WebFetch tool schema',
    ]);
  });

  it('names the skill intent rather than echoing "Skill"', () => {
    expect(toolPhrases('Skill', { skill: 'update-config', args: '...' })).toEqual([
      'update claude code config',
    ]);
  });

  it('falls back to the lowercased tool name for unknown tools', () => {
    expect(toolPhrases('SomeTool', {})).toEqual(['sometool']);
  });
});

describe('invokePhrase', () => {
  it('treats a skill call as its own action', () => {
    expect(invokePhrase({ name: 'Skill', input: { skill: 'update-config' } })).toBe(
      'decide on skill use',
    );
  });

  it('prefixes the derived tool intent with "invoke"', () => {
    expect(
      invokePhrase({ name: 'Read', input: { file_path: '/Users/x/.claude/settings.json' } }),
    ).toBe('invoke read claude code user settings');
  });
});

describe('response/request detectors', () => {
  it('detects a session-title JSON response', () => {
    expect(isSessionTitleResponse('{"title": "Add Grafana MCP server"}')).toBe(true);
    expect(isSessionTitleResponse('Translate all titles into Hebrew')).toBe(false);
  });

  it('detects suggestion-mode from the injected marker', () => {
    expect(isSuggestionMode([{ role: 'user', content: '[SUGGESTION MODE: predict next]' }])).toBe(
      true,
    );
    expect(isSuggestionMode([{ role: 'user', content: 'fetch ynet.co.il' }])).toBe(false);
  });

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
