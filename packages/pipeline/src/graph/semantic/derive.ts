import type { RequestMessage, ResponseMessage } from '../../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Deterministic label derivation — everything the labeler model is bad at, done
// in code. Tool intent (verb from the tool name, object from the input), the
// structural inference roles (thinking → plan, tool_use → invoke), and the
// harness's own calls (session-title, suggestion-mode). The model is reserved
// for the one thing it can do: classifying the act of a final assistant message.
//
// Pure module (no node:* imports), like the stage that consumes it.
// ════════════════════════════════════════════════════════════════════════════

export const SESSION_TITLE_LABEL = 'generate session title';
export const PREDICT_PROMPT_LABEL = 'predict next user prompt';
export const PLAN_LABEL = 'plan next steps';

// Stable harness signature: Claude Code's "suggest the user's next input" call
// injects this marker as the user turn. The response is a *fabricated* prompt, so
// the node's action is "predict", regardless of what the predicted text says.
const SUGGESTION_MARKER = '[SUGGESTION MODE';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function strField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === 'string' ? value : '';
}

// ── Message-block extraction ────────────────────────────────────────────────--

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isRecord)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}

/** The first non-empty assistant text block, or undefined when there is none. */
export function responseText(messages: readonly ResponseMessage[]): string | undefined {
  const block = messages.find((m) => m.type === 'text' && typeof m.text === 'string');
  const text = block != null ? String(block.text).trim() : '';
  return text === '' ? undefined : text;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export function responseToolCall(messages: readonly ResponseMessage[]): ToolCall | undefined {
  const block = messages.find((m) => m.type === 'tool_use' && typeof m.name === 'string');
  if (block == null) return undefined;
  return { name: String(block.name), input: isRecord(block.input) ? block.input : {} };
}

export function hasThinking(messages: readonly ResponseMessage[]): boolean {
  return messages.some((m) => m.type === 'thinking');
}

export function isSuggestionMode(messages: readonly RequestMessage[]): boolean {
  return messages.some((m) => textFromContent(m.content).trimStart().startsWith(SUGGESTION_MARKER));
}

/** A session-title call returns a JSON object whose only meaningful key is `title`. */
export function isSessionTitleResponse(text: string): boolean {
  if (!text.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && typeof parsed.title === 'string';
  } catch {
    return false;
  }
}

// ── Tool intent — heuristic and deliberately small ─────────────────────────────
// Object-generalization (`~/.claude/settings.json` → "claude code user settings")
// needs world knowledge a small model applies inconsistently, so it lives here as
// rules. Extend the handler map and path/url heuristics as new tools appear.

export function parseToolInput(input: string | undefined): Record<string, unknown> {
  if (input == null) return {};
  try {
    const parsed: unknown = JSON.parse(input);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function describePath(path: string): string {
  if (path.includes('/.claude/')) {
    return path.endsWith('settings.json') ? 'claude code user settings' : 'claude code config';
  }
  return path.split('/').pop() ?? path;
}

function hostOf(url: string): string {
  const host = url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  return host != null && host !== '' ? host : url;
}

function webFetchPhrases(input: Record<string, unknown>): readonly string[] {
  const phrases = [`fetch ${hostOf(strField(input, 'url'))}`];
  if (/summar/i.test(strField(input, 'prompt'))) phrases.push('summarize content');
  return phrases;
}

function toolSearchPhrases(input: Record<string, unknown>): readonly string[] {
  const match = /select:([A-Za-z0-9_]+)/.exec(strField(input, 'query'));
  const tool = match?.[1];
  return [tool != null ? `load ${tool} tool schema` : 'load tool schema'];
}

function skillPhrases(input: Record<string, unknown>): readonly string[] {
  const skill = strField(input, 'skill');
  if (skill === 'update-config') return ['update claude code config'];
  return skill !== '' ? [`use ${skill.replace(/-/g, ' ')} skill`] : ['use skill'];
}

type ToolHandler = (input: Record<string, unknown>) => readonly string[];

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  Read: (input) => [`read ${describePath(strField(input, 'file_path'))}`],
  Edit: (input) => [`edit ${describePath(strField(input, 'file_path'))}`],
  Write: (input) => [`edit ${describePath(strField(input, 'file_path'))}`],
  NotebookEdit: (input) => [`edit ${describePath(strField(input, 'file_path'))}`],
  WebFetch: webFetchPhrases,
  ToolSearch: toolSearchPhrases,
  Skill: skillPhrases,
  Bash: () => ['run command'],
  Task: () => ['delegate to subagent'],
};

export function toolPhrases(
  name: string | undefined,
  input: Record<string, unknown>,
): readonly string[] {
  const handler = name != null ? TOOL_HANDLERS[name] : undefined;
  if (handler != null) return handler(input);
  return [name != null && name !== '' ? name.toLowerCase() : 'tool'];
}

/** The action of the inference that *decided* to make this tool call. */
export function invokePhrase(call: ToolCall): string {
  if (call.name === 'Skill') return 'decide on skill use';
  return `invoke ${toolPhrases(call.name, call.input)[0] ?? 'tool'}`;
}
