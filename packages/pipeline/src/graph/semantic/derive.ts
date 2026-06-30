import { actionLabel, coarseAction, isRecord, type SemanticsConfig } from '@coach/semantics';

import type { RequestMessage, ResponseMessage, SemanticEntry } from '../../types.ts';

import { toolEntries } from './tool-intent.ts';

// ════════════════════════════════════════════════════════════════════════════
// derive.ts — turns a raw llm_request node into deterministic semantic entries,
// reading all harness-specific knowledge from the injected SemanticsConfig. It is
// HARNESS-AGNOSTIC: the only thing baked in is the pipeline's normalized message
// shape (a ResponseMessage has a `type`; text blocks have `text`; tool-call blocks
// have `name`/`input`). Every string that means something to a particular agent —
// tool names, which block types map to which role, the session-title/suggestion
// markers — comes from config, not from this file.
//
// Three deterministic signals, in the order the stage applies them:
//   1. markerEntries()     harness-internal calls (session title, suggestion mode)
//                          that fully determine the label — no model needed.
//   2. structuralEntries() roles read from the response shape: a thinking block →
//                          "plan…", a trailing tool call → "invoke <tool intent>".
//   3. toolEntries()       (tool-intent.ts) the tool/command intent itself.
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

function toToolCall(block: ResponseMessage): ToolCall {
  return { name: String(block.name), input: isRecord(block.input) ? block.input : {} };
}

/** All tool-call blocks of the given content type (the type string comes from a
 *  structural-role rule, never hardcoded). */
function toolCallsOfType(messages: readonly ResponseMessage[], type: string): ToolCall[] {
  return messages.filter((m) => m.type === type && typeof m.name === 'string').map(toToolCall);
}

/** The first tool-call block of the given type, used for existence checks. */
function toolCallOfType(messages: readonly ResponseMessage[], type: string): ToolCall | undefined {
  const block = messages.find((m) => m.type === type && typeof m.name === 'string');
  return block != null ? toToolCall(block) : undefined;
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

// Promoted-column source: the single source of truth for the bash command carried
// in a tool node's `tool_input` — read by the materializer (nodes.bash_command) and
// the shell-command action classifier.
function firstNonEmptyField(
  input: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

/** The shell command of a Bash tool's input (`command`), or NULL when absent.
 *  Total: never throws — malformed/missing input yields NULL. */
export function extractBashCommand(input: Record<string, unknown>): string | null {
  return firstNonEmptyField(input, ['command']);
}

// ── Structural roles — driven by the block-type strings declared in config ─────

type StructuralRole = SemanticsConfig['agent']['structuralRoles']['rules'][number];

/** The entry for one structural tool-call: the underlying tool's STATIC base entry
 *  (label + coarse action + the argument it touched), with its label wrapped by the
 *  role phrase ("read source code" → "invoke read source code"). An override replaces
 *  only the label; the tool's action / `rawPath` / `url` carry through, so an
 *  inference that fires two reads emits two entries each carrying its own path. */
function invokeEntry(config: SemanticsConfig, rule: StructuralRole, call: ToolCall): SemanticEntry {
  const base: SemanticEntry = toolEntries(config, call.name, call.input)[0] ?? { static: 'tool' };
  const override = rule.overrides?.find((o) => o.when.toolName === call.name);
  const label =
    override != null ? override.phrase : rule.phrase.replace('{toolPhrase}', base.static);
  return { ...base, static: label };
}

function roleEntries(
  config: SemanticsConfig,
  rule: StructuralRole,
  response: readonly ResponseMessage[],
): SemanticEntry[] {
  const { responseHasBlockType: hasType, responseEndsWithBlockType: endsType } = rule.when;
  if (hasType != null && responseHasBlockType(response, hasType))
    return [{ static: rule.phrase, action: coarseAction(config, rule.action) }];
  if (endsType != null)
    return toolCallsOfType(response, endsType).map((call) => invokeEntry(config, rule, call));
  return [];
}

/** Deterministic prefix entries for an inference — one per matching structural role
 *  (e.g. [{static:"plan next steps"}, {static:"invoke read source code", rawPath:…}]).
 *  When a turn invokes multiple tools in parallel, each generates its own entry. */
export function structuralEntries(
  config: SemanticsConfig,
  response: readonly ResponseMessage[],
): SemanticEntry[] {
  return config.agent.structuralRoles.rules.flatMap((rule) => roleEntries(config, rule, response));
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

/** The deterministic entry for a harness-internal call (session title, suggestion
 *  mode, …), or undefined when no marker matches. A single static entry carrying the
 *  marker's action label + coarse bucket. */
export function markerEntries(
  config: SemanticsConfig,
  request: readonly RequestMessage[],
  response: readonly ResponseMessage[],
): SemanticEntry[] | undefined {
  const respText = responseText(response) ?? '';
  const matched = config.agent.markers.rules.find((marker) => {
    const { responseJsonHasStringKey, requestTextStartsWith } = marker.when;
    if (responseJsonHasStringKey != null)
      return jsonHasStringKey(respText, responseJsonHasStringKey);
    if (requestTextStartsWith != null) return requestStartsWith(request, requestTextStartsWith);
    return false;
  });
  if (matched == null) return undefined;
  return [
    { static: actionLabel(config, matched.action), action: coarseAction(config, matched.action) },
  ];
}
