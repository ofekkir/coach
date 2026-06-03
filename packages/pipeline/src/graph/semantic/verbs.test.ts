import { describe, expect, it } from 'vitest';
import { actionVerbFromNode, inferenceMovesFromRawResponse } from './verbs.ts';

describe('inferenceMovesFromRawResponse', () => {
  it('returns empty array for undefined input', () => {
    expect(inferenceMovesFromRawResponse(undefined)).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(inferenceMovesFromRawResponse('not-json')).toEqual([]);
  });

  it('returns empty array when content is absent', () => {
    expect(inferenceMovesFromRawResponse(JSON.stringify({ stop_reason: 'end_turn' }))).toEqual([]);
  });

  it('maps thinking block to reason move', () => {
    const raw = JSON.stringify({ content: [{ type: 'thinking' }], stop_reason: 'tool_use' });
    expect(inferenceMovesFromRawResponse(raw)).toEqual([{ verb: 'reason', blockType: 'thinking' }]);
  });

  it('maps tool_use block to act move', () => {
    const raw = JSON.stringify({ content: [{ type: 'tool_use' }], stop_reason: 'tool_use' });
    expect(inferenceMovesFromRawResponse(raw)).toEqual([{ verb: 'act', blockType: 'tool_use' }]);
  });

  it('maps text block at end_turn to answer', () => {
    const raw = JSON.stringify({
      content: [{ type: 'text', text: 'Here are the results.' }],
      stop_reason: 'end_turn',
    });
    expect(inferenceMovesFromRawResponse(raw)).toEqual([{ verb: 'answer', blockType: 'text' }]);
  });

  it('maps text block during tool loop to summarize', () => {
    const raw = JSON.stringify({
      content: [{ type: 'text', text: 'Running the tool now.' }],
      stop_reason: 'tool_use',
    });
    expect(inferenceMovesFromRawResponse(raw)).toEqual([{ verb: 'summarize', blockType: 'text' }]);
  });

  it('maps JSON-object text block to generate (title-gen side-call)', () => {
    const raw = JSON.stringify({
      content: [{ type: 'text', text: '{"title":"My Session"}' }],
      stop_reason: 'end_turn',
    });
    expect(inferenceMovesFromRawResponse(raw)).toEqual([{ verb: 'generate', blockType: 'text' }]);
  });

  it('produces multiple moves from multiple blocks in order', () => {
    const raw = JSON.stringify({
      content: [{ type: 'thinking' }, { type: 'text', text: 'Found it.' }, { type: 'tool_use' }],
      stop_reason: 'tool_use',
    });
    expect(inferenceMovesFromRawResponse(raw)).toEqual([
      { verb: 'reason', blockType: 'thinking' },
      { verb: 'summarize', blockType: 'text' },
      { verb: 'act', blockType: 'tool_use' },
    ]);
  });

  it('ignores unknown block types', () => {
    const raw = JSON.stringify({
      content: [{ type: 'document' }, { type: 'text', text: 'Done.' }],
      stop_reason: 'end_turn',
    });
    expect(inferenceMovesFromRawResponse(raw)).toEqual([{ verb: 'answer', blockType: 'text' }]);
  });
});

describe('actionVerbFromNode', () => {
  it('returns tool name for non-Bash tools', () => {
    expect(actionVerbFromNode('Read', undefined)).toBe('Read');
    expect(actionVerbFromNode('Edit', 'some/path')).toBe('Edit');
    expect(actionVerbFromNode('WebFetch', 'https://example.com')).toBe('WebFetch');
  });

  it('returns "unknown" for undefined name', () => {
    expect(actionVerbFromNode(undefined, undefined)).toBe('unknown');
  });

  it('prefixes Bash with first command token', () => {
    expect(actionVerbFromNode('Bash', 'git push origin main')).toBe('Bash git');
    expect(actionVerbFromNode('Bash', 'pnpm test')).toBe('Bash pnpm');
    expect(actionVerbFromNode('Bash', 'ls -la')).toBe('Bash ls');
  });

  it('returns plain "Bash" when tool_input is empty or whitespace', () => {
    expect(actionVerbFromNode('Bash', '')).toBe('Bash');
    expect(actionVerbFromNode('Bash', '   ')).toBe('Bash');
  });

  it('returns plain "Bash" when tool_input is undefined', () => {
    expect(actionVerbFromNode('Bash', undefined)).toBe('Bash');
  });
});
