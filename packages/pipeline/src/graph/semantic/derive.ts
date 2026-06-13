import type { RequestMessage, ResponseMessage } from '../../types.ts';
import { actionLabel, isRecord, type SemanticsConfig } from './config.ts';
import { toolPhrases } from './tool-intent.ts';

// ════════════════════════════════════════════════════════════════════════════
// Deterministic label derivation, driven by the injected SemanticsConfig. The
// structural message helpers below are content-shape only (not config-driven);
// the harness markers and structural roles are read from config.agent. Tool
// intent lives in tool-intent.ts. The model is reserved for classifying the act
// of a genuine final assistant message.
//
// Pure module (no node:* imports), like the stage that consumes it.
// ════════════════════════════════════════════════════════════════════════════

// ── Message-block extraction (structural — not config-driven) ──────────────────

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

export function parseToolInput(input: string | undefined): Record<string, unknown> {
  if (input == null) return {};
  try {
    const parsed: unknown = JSON.parse(input);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ── Structural roles (thinking → plan, tool_use → invoke) ──────────────────────

/** The action of the inference that *decided* to make this tool call. */
export function invokePhrase(config: SemanticsConfig, call: ToolCall): string {
  const rule = config.agent.structuralRoles.rules.find(
    (r) => r.when.responseEndsWithBlockType === 'tool_use',
  );
  const override = rule?.overrides?.find((o) => o.when.toolName === call.name);
  if (override != null) return override.phrase;
  const toolPhrase = toolPhrases(config, call.name, call.input)[0] ?? 'tool';
  return (rule?.phrase ?? 'invoke {toolPhrase}').replace('{toolPhrase}', toolPhrase);
}

/** Deterministic prefix phrases derived from response-message structure. */
export function structuralPrefix(
  config: SemanticsConfig,
  response: readonly ResponseMessage[],
): string[] {
  const prefix: string[] = [];
  const thinkingRule = config.agent.structuralRoles.rules.find(
    (r) => r.when.responseHasBlockType === 'thinking',
  );
  if (thinkingRule != null && hasThinking(response)) prefix.push(thinkingRule.phrase);
  const call = responseToolCall(response);
  if (call != null) prefix.push(invokePhrase(config, call));
  return prefix;
}

// ── Harness markers (session-title, suggestion-mode) ───────────────────────────

function jsonHasStringKey(text: string, key: string): boolean {
  if (!text.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && typeof parsed[key] === 'string';
  } catch {
    return false;
  }
}

function requestStartsWith(request: readonly RequestMessage[], prefix: string): boolean {
  return request.some((m) => textFromContent(m.content).trimStart().startsWith(prefix));
}

/** The deterministic label for a harness-internal call (session title,
 *  suggestion mode, …), or undefined when no marker matches. */
export function markerLabel(
  config: SemanticsConfig,
  request: readonly RequestMessage[],
  response: readonly ResponseMessage[],
): readonly string[] | undefined {
  const respText = responseText(response) ?? '';
  const matched = config.agent.markers.rules.find((marker) => {
    const { responseJsonHasStringKey, requestTextStartsWith } = marker.when;
    if (responseJsonHasStringKey != null)
      return jsonHasStringKey(respText, responseJsonHasStringKey);
    if (requestTextStartsWith != null) return requestStartsWith(request, requestTextStartsWith);
    return false;
  });
  return matched != null ? [actionLabel(config, matched.action)] : undefined;
}
