import { describe, expect, it } from 'vitest';
import { defaultSemanticsConfig } from '@coach/semantics';
import {
  extractBashCommand,
  extractFilePath,
  markerLabel,
  parseToolInput,
  responseText,
  structuralPrefix,
} from './derive.ts';
import { toolPhrases } from './tool-intent.ts';

describe('extractFilePath / extractBashCommand (promoted-column source)', () => {
  it('pulls file_path from a Read input and leaves the command NULL', () => {
    const input = parseToolInput(JSON.stringify({ file_path: '/tmp/a.ts' }));
    expect(extractFilePath(input)).toBe('/tmp/a.ts');
    expect(extractBashCommand(input)).toBeNull();
  });

  it('pulls notebook_path for NotebookEdit', () => {
    expect(extractFilePath(parseToolInput(JSON.stringify({ notebook_path: '/n.ipynb' })))).toBe(
      '/n.ipynb',
    );
  });

  it('pulls command from a Bash input and leaves the path NULL', () => {
    const input = parseToolInput(JSON.stringify({ command: 'ls -la' }));
    expect(extractBashCommand(input)).toBe('ls -la');
    expect(extractFilePath(input)).toBeNull();
  });

  it('returns NULL for both on malformed/missing input and never throws', () => {
    const malformed = parseToolInput('{not json');
    expect(extractFilePath(malformed)).toBeNull();
    expect(extractBashCommand(malformed)).toBeNull();

    const empty = parseToolInput(undefined);
    expect(extractFilePath(empty)).toBeNull();
    expect(extractBashCommand(empty)).toBeNull();

    const wrongTypes = parseToolInput(JSON.stringify({ file_path: 42, command: false }));
    expect(extractFilePath(wrongTypes)).toBeNull();
    expect(extractBashCommand(wrongTypes)).toBeNull();
  });
});

describe('toolPhrases (config-driven)', () => {
  it('derives read intent and the agent well-known path label, not the tool name', () => {
    expect(
      toolPhrases(defaultSemanticsConfig, 'Read', { file_path: '/Users/x/.claude/settings.json' }),
    ).toEqual(['read claude code user settings']);
  });

  it('maps Edit to an edit intent on the same well-known object', () => {
    expect(
      toolPhrases(defaultSemanticsConfig, 'Edit', { file_path: '/Users/x/.claude/settings.json' }),
    ).toEqual(['edit claude code user settings']);
  });

  it('renders the convention object type + structural qualifier for a workspace path', () => {
    expect(
      toolPhrases(defaultSemanticsConfig, 'Edit', {
        file_path: 'packages/pipeline/src/graph/semantic/derive.ts',
      }),
    ).toEqual(['edit source code (package=pipeline)']);
  });

  it('fetches + notes weak-model processing when WebFetch carries a prompt', () => {
    expect(
      toolPhrases(defaultSemanticsConfig, 'WebFetch', {
        url: 'https://www.ynet.co.il',
        prompt: 'Summarize the headlines',
      }),
    ).toEqual(['fetch ynet.co.il', 'process result with weak model']);
  });

  it('reads the selected tool out of a ToolSearch query via the extract regex', () => {
    expect(
      toolPhrases(defaultSemanticsConfig, 'ToolSearch', {
        query: 'select:WebFetch',
        max_results: 5,
      }),
    ).toEqual(['load WebFetch tool schema']);
  });

  it('names the skill intent from the skill field', () => {
    expect(
      toolPhrases(defaultSemanticsConfig, 'Skill', { skill: 'update-config', args: '...' }),
    ).toEqual(['use update-config skill']);
  });

  it('falls back to the lowercased tool name for unknown tools', () => {
    expect(toolPhrases(defaultSemanticsConfig, 'SomeTool', {})).toEqual(['sometool']);
  });
});

describe('structuralPrefix (config-driven roles)', () => {
  it('uses the tool_use rule override for a Skill call', () => {
    expect(
      structuralPrefix(defaultSemanticsConfig, [
        { type: 'tool_use', name: 'Skill', input: { skill: 'x' } },
      ]),
    ).toEqual(['decide on skill use']);
  });

  it('emits thinking → plan then the derived tool intent for a trailing tool call', () => {
    expect(
      structuralPrefix(defaultSemanticsConfig, [
        { type: 'thinking', thinking: '<REDACTED>' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/Users/x/.claude/settings.json' } },
      ]),
    ).toEqual(['plan next steps', 'invoke read claude code user settings']);
  });

  it('emits nothing for a plain terminal text message', () => {
    expect(structuralPrefix(defaultSemanticsConfig, [{ type: 'text', text: 'all done' }])).toEqual(
      [],
    );
  });
});

describe('markerLabel (config-driven harness markers)', () => {
  it('labels a session-title JSON response from the responseJsonHasStringKey rule', () => {
    expect(
      markerLabel(
        defaultSemanticsConfig,
        [],
        [{ type: 'text', text: '{"title": "Add Grafana MCP server"}' }],
      ),
    ).toEqual(['generate session title']);
  });

  it('labels suggestion mode from the requestTextStartsWith rule', () => {
    expect(
      markerLabel(
        defaultSemanticsConfig,
        [{ role: 'user', content: '[SUGGESTION MODE: predict next]' }],
        [],
      ),
    ).toEqual(['predict next user prompt']);
  });

  it('returns undefined when no marker matches', () => {
    expect(
      markerLabel(
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
