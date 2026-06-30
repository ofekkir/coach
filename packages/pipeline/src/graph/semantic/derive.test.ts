import { defaultSemanticsConfig } from '@coach/semantics';
import { describe, expect, it } from 'vitest';

import {
  extractBashCommand,
  markerEntries,
  parseToolInput,
  responseText,
  structuralEntries,
} from './derive.ts';
import { toolEntries } from './tool-intent.ts';

const actions = (entries: { action: string }[]): string[] => entries.map((e) => e.action);

describe('extractBashCommand (promoted-column source)', () => {
  it('pulls command from a Bash input', () => {
    expect(extractBashCommand(parseToolInput(JSON.stringify({ command: 'ls -la' })))).toBe(
      'ls -la',
    );
  });

  it('returns NULL on missing/malformed input and never throws', () => {
    expect(extractBashCommand(parseToolInput('{not json'))).toBeNull();
    expect(extractBashCommand(parseToolInput(undefined))).toBeNull();
    expect(extractBashCommand(parseToolInput(JSON.stringify({ command: false })))).toBeNull();
  });
});

describe('toolEntries (config-driven, static labels)', () => {
  it('derives read intent and the agent well-known path label, not the tool name', () => {
    const entries = toolEntries(defaultSemanticsConfig, 'Read', {
      file_path: '/Users/x/.claude/settings.json',
    });
    expect(entries).toEqual([
      { action: 'read claude code user settings', rawPath: '/Users/x/.claude/settings.json' },
    ]);
  });

  it('renders the convention object TYPE — the specific file lives on rawPath, not the label', () => {
    const entries = toolEntries(defaultSemanticsConfig, 'Edit', {
      file_path: 'packages/pipeline/src/graph/semantic/derive.ts',
    });
    expect(actions(entries)).toEqual(['edit source code']);
    expect(entries[0]?.rawPath).toBe('packages/pipeline/src/graph/semantic/derive.ts');
    // package / repoPath are NOT grounded here — that is stage 7 (resolve).
    expect(entries[0]?.repoPath).toBeUndefined();
    expect(entries[0]?.package).toBeUndefined();
  });

  it('drops the specific URL from the label and carries the host on `url`', () => {
    const entries = toolEntries(defaultSemanticsConfig, 'WebFetch', {
      url: 'https://www.example.com',
      prompt: 'Summarize the headlines',
    });
    expect(actions(entries)).toEqual(['fetch web page', 'process result with weak model']);
    expect(entries[0]?.url).toBe('example.com');
  });

  it('gives every "load a tool schema" the SAME static label (input stripped)', () => {
    const a = toolEntries(defaultSemanticsConfig, 'ToolSearch', { query: 'select:WebFetch' });
    const b = toolEntries(defaultSemanticsConfig, 'ToolSearch', { query: 'select:EnterWorktree' });
    expect(actions(a)).toEqual(['load tool schema']);
    expect(actions(b)).toEqual(['load tool schema']);
  });

  it('names the skill intent without the specific skill', () => {
    expect(
      actions(toolEntries(defaultSemanticsConfig, 'Skill', { skill: 'update-config' })),
    ).toEqual(['use skill']);
  });

  it('falls back to the lowercased tool name for unknown tools', () => {
    expect(actions(toolEntries(defaultSemanticsConfig, 'SomeTool', {}))).toEqual(['sometool']);
  });
});

describe('structuralEntries (config-driven roles)', () => {
  it('uses the tool_use rule override for a Skill call', () => {
    const entries = structuralEntries(defaultSemanticsConfig, [
      { type: 'tool_use', name: 'Skill', input: { skill: 'x' } },
    ]);
    expect(actions(entries)).toEqual(['decide on skill use']);
  });

  it('emits thinking → plan then the derived tool intent for a trailing tool call', () => {
    const entries = structuralEntries(defaultSemanticsConfig, [
      { type: 'thinking', thinking: '<REDACTED>' },
      { type: 'tool_use', name: 'Read', input: { file_path: '/Users/x/.claude/settings.json' } },
    ]);
    expect(actions(entries)).toEqual(['plan next steps', 'invoke read claude code user settings']);
    // the invoke entry carries the call's own path, so parallel calls each keep theirs
    expect(entries[1]?.rawPath).toBe('/Users/x/.claude/settings.json');
  });

  it('emits nothing for a plain terminal text message', () => {
    expect(structuralEntries(defaultSemanticsConfig, [{ type: 'text', text: 'all done' }])).toEqual(
      [],
    );
  });
});

describe('markerEntries (config-driven harness markers)', () => {
  it('labels a session-title JSON response from the responseJsonHasStringKey rule', () => {
    const entries = markerEntries(
      defaultSemanticsConfig,
      [],
      [{ type: 'text', text: '{"title": "Add Grafana MCP server"}' }],
    );
    expect(entries != null && actions(entries)).toEqual(['generate session title']);
  });

  it('labels suggestion mode from the requestTextStartsWith rule', () => {
    const entries = markerEntries(
      defaultSemanticsConfig,
      [{ role: 'user', content: '[SUGGESTION MODE: predict next]' }],
      [],
    );
    expect(entries != null && actions(entries)).toEqual(['predict next user prompt']);
  });

  it('returns undefined when no marker matches', () => {
    expect(
      markerEntries(
        defaultSemanticsConfig,
        [{ role: 'user', content: 'hi' }],
        [{ type: 'text', text: 'ok' }],
      ),
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
