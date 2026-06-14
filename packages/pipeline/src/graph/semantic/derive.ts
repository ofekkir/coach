import type { RequestMessage, ResponseMessage } from '../../types.ts';
import { actionLabel, isRecord, type SemanticsConfig } from '@coach/semantics';
import { toolPhrases } from './tool-intent.ts';

// ════════════════════════════════════════════════════════════════════════════
// derive.ts — turns a raw llm_request node into deterministic label phrases,
// reading all harness-specific knowledge from the injected SemanticsConfig. It is
// HARNESS-AGNOSTIC: the only thing baked in is the pipeline's normalized message
// shape (a ResponseMessage has a `type`; text blocks have `text`; tool-call blocks
// have `name`/`input`). Every string that means something to a particular agent —
// tool names, which block types map to which role, the session-title/suggestion
// markers — comes from config, not from this file.
//
// Three deterministic signals, in the order the stage applies them:
//   1. markerLabel()      harness-internal calls (session title, suggestion mode)
//                         that fully determine the label — no model needed.
//   2. structuralPrefix() roles read from the response shape: a thinking block →
//                         "plan…", a trailing tool call → "invoke <tool intent>".
//   3. toolPhrases()      (tool-intent.ts) the tool/command intent itself.
// What is left — the act of a genuine final text message — is the model's job.
//
// Pure module (no node:* imports), like the stage that consumes it.
// ════════════════════════════════════════════════════════════════════════════

// ── Message-block extraction (the normalized content shape, not agent-specific) ─

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

/** A tool-call block of the given content type (the type string comes from a
 *  structural-role rule, never hardcoded). */
function toolCallOfType(messages: readonly ResponseMessage[], type: string): ToolCall | undefined {
  const block = messages.find((m) => m.type === type && typeof m.name === 'string');
  if (block == null) return undefined;
  return { name: String(block.name), input: isRecord(block.input) ? block.input : {} };
}

/** Whether any response block has the given content type. */
function responseHasBlockType(messages: readonly ResponseMessage[], type: string): boolean {
  return messages.some((m) => m.type === type);
}

/** Does the turn end in a tool call rather than a final message? Used by the
 *  stage to decide whether a node's text is terminal or mere tool preamble. The
 *  `tool_use` content type is the normalized shape, not an agent label. */
export function responseToolCall(messages: readonly ResponseMessage[]): ToolCall | undefined {
  return toolCallOfType(messages, 'tool_use');
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

// ── Structural roles — driven by the block-type strings declared in config ─────

type StructuralRole = SemanticsConfig['agent']['structuralRoles']['rules'][number];

function invokePhrase(config: SemanticsConfig, rule: StructuralRole, call: ToolCall): string {
  const override = rule.overrides?.find((o) => o.when.toolName === call.name);
  if (override != null) return override.phrase;
  const toolPhrase = toolPhrases(config, call.name, call.input)[0] ?? 'tool';
  return rule.phrase.replace('{toolPhrase}', toolPhrase);
}

function rolePhrase(
  config: SemanticsConfig,
  rule: StructuralRole,
  response: readonly ResponseMessage[],
): string | undefined {
  const { responseHasBlockType: hasType, responseEndsWithBlockType: endsType } = rule.when;
  if (hasType != null && responseHasBlockType(response, hasType)) return rule.phrase;
  if (endsType != null) {
    const call = toolCallOfType(response, endsType);
    if (call != null) return invokePhrase(config, rule, call);
  }
  return undefined;
}

/** Deterministic prefix phrases for an inference — one per matching structural
 *  role (e.g. ["plan next steps", "invoke read package.json"]). */
export function structuralPrefix(
  config: SemanticsConfig,
  response: readonly ResponseMessage[],
): string[] {
  return config.agent.structuralRoles.rules
    .map((rule) => rolePhrase(config, rule, response))
    .filter((phrase): phrase is string => phrase != null);
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
