import {
  actionLabel,
  objectLabel,
  shellCommandAction,
  strField,
  type MatchClause,
  type SemanticsConfig,
  type ToolModifier,
  type ToolOverride,
  type ToolSemantics,
} from '@coach/semantics';

import { stripWorktreeSegment } from '../../db/repo-path.ts';

import { extractBashCommand } from './derive.ts';

// ════════════════════════════════════════════════════════════════════════════
// Tool & command intent — resolved entirely from config.agent.tools and the
// ontology's command grammar + path/structure conventions. No hardcoded tool tables.
// ════════════════════════════════════════════════════════════════════════════

// ── Matching primitives ────────────────────────────────────────────────────────

function matchClause(clause: MatchClause, input: Record<string, unknown>): boolean {
  const value = strField(input, clause.field);
  if (clause.equals != null) return value === clause.equals;
  if (clause.matches != null) return new RegExp(clause.matches, 'i').test(value);
  return false;
}

// ── Path grounding — convention object type + structural qualifier ─────────────

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function wellKnownLabel(config: SemanticsConfig, path: string): string | undefined {
  const rule = config.agent.wellKnownPaths?.rules.find((r) => new RegExp(r.match).test(path));
  return rule?.label;
}

/** The ontology object label a path resolves to via the generic file-role
 *  conventions (first match wins). Undefined when nothing matches or the match is
 *  the escape object — caller falls back to the basename. */
function groundedType(config: SemanticsConfig, path: string): string | undefined {
  const rules = config.ontology.conventions?.paths.rules ?? [];
  const rule = rules.find((r) => new RegExp(r.match, 'i').test(path));
  if (rule == null || rule.object === config.ontology.escape.object) return undefined;
  return objectLabel(config, rule.object);
}

/** A structural qualifier (e.g. `package=pipeline`) deduced from generic layout
 *  conventions — the monorepo workspace a path lives in. Undefined when none match. */
function structureQualifier(config: SemanticsConfig, path: string): string | undefined {
  const rules = config.ontology.conventions?.structure?.rules ?? [];
  for (const rule of rules) {
    const captured = new RegExp(rule.match, 'i').exec(path)?.[1];
    if (captured != null && captured !== '') return `${rule.qualifier}=${captured}`;
  }
  return undefined;
}

/** Convention-based rendering: well-known agent paths keep their semantic name;
 *  otherwise render the convention object type plus any structural qualifier
 *  (`source code (package=pipeline)`). Unknown type → just the basename (the full
 *  path is preserved on the canonical node for detail display). */
function renderPathObject(config: SemanticsConfig, rawPath: string): string {
  const path = stripWorktreeSegment(rawPath);
  const known = wellKnownLabel(config, path);
  if (known != null) return known;
  const type = groundedType(config, path);
  if (type == null) return basename(path);
  const qualifier = structureQualifier(config, path);
  return qualifier != null ? `${type} (${qualifier})` : type;
}

function hostOf(url: string): string {
  const host = url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  return host != null && host !== '' ? host : url;
}

// ── Tool intent ────────────────────────────────────────────────────────────────

interface Resolved {
  action?: string | undefined;
  object?: string | undefined;
  label?: string | undefined;
  phrase?: string | undefined;
}

function applyOverrides(
  overrides: readonly ToolOverride[] | undefined,
  input: Record<string, unknown>,
  base: Resolved,
): Resolved {
  const hit = overrides?.find((o) => matchClause(o.when, input));
  if (hit == null) return base;
  return {
    action: hit.action ?? base.action,
    object: hit.object ?? base.object,
    label: hit.label ?? base.label,
    phrase: hit.phrase ?? base.phrase,
  };
}

interface Target {
  target: string;
  objectRender?: string;
  usedFallback: boolean;
}

function targetString(
  config: SemanticsConfig,
  tool: ToolSemantics,
  input: Record<string, unknown>,
): Target {
  const spec = tool.target;
  if (spec == null || spec.kind === 'none') return { target: '', usedFallback: false };
  const raw = spec.field != null ? strField(input, spec.field) : '';
  if (spec.kind === 'host') return { target: hostOf(raw), usedFallback: false };
  if (spec.kind === 'path') {
    return {
      target: basename(raw),
      objectRender: renderPathObject(config, raw),
      usedFallback: false,
    };
  }
  if (spec.extract == null) return { target: raw, usedFallback: false };
  const match = new RegExp(spec.extract).exec(raw);
  if (match?.[1] != null) return { target: match[1], usedFallback: false };
  return { target: raw, usedFallback: true };
}

function fillPhrase(
  template: string,
  parts: { target: string; objectRender?: string | undefined; toolName: string },
): string {
  return template
    .replace('{target}', parts.target)
    .replace('{object}', parts.objectRender ?? parts.target)
    .replace('{toolNameLower}', parts.toolName.toLowerCase())
    .trim();
}

function modifierPhrases(
  modifiers: readonly ToolModifier[] | undefined,
  input: Record<string, unknown>,
): string[] {
  return (modifiers ?? []).filter((m) => matchClause(m.when, input)).map((m) => m.append.label);
}

function basePhrase(
  config: SemanticsConfig,
  name: string,
  tool: ToolSemantics,
  resolved: Resolved,
  input: Record<string, unknown>,
): string {
  if (resolved.label != null) return resolved.label;
  const { target, objectRender, usedFallback } = targetString(config, tool, input);
  const template =
    usedFallback && tool.fallbackPhrase != null ? tool.fallbackPhrase : resolved.phrase;
  if (template != null) return fillPhrase(template, { target, objectRender, toolName: name });
  return `${actionLabel(config, resolved.action)} ${objectRender ?? target}`.trim();
}

const MCP_TOOL_PREFIX = 'mcp__';

/** The agent's configured tool spec for a tool name, falling back to the
 *  `_unknownTool` catch-all. Undefined only when neither is configured. */
function toolSpecFor(config: SemanticsConfig, name: string | undefined): ToolSemantics | undefined {
  return (name != null ? config.agent.tools[name] : undefined) ?? config.agent.tools._unknownTool;
}

/** Ordered action phrases for a tool call, resolved entirely from config. */
export function toolPhrases(
  config: SemanticsConfig,
  name: string | undefined,
  input: Record<string, unknown>,
): readonly string[] {
  const tool = toolSpecFor(config, name);
  if (tool == null) return [name != null && name !== '' ? name.toLowerCase() : 'tool'];
  // Escape-hatch tools (Bash, run_command) wrap arbitrary shell — label by tool name only.
  if (tool.escapeHatch) return [name != null ? name.toLowerCase() : 'shell'];
  const resolved = applyOverrides(tool.overrides, input, {
    action: tool.action,
    object: tool.object,
    phrase: tool.phrase,
  });
  return [
    basePhrase(config, name ?? '', tool, resolved, input),
    ...modifierPhrases(tool.modifiers, input),
  ];
}

/** The single ontology action id a tool call resolves to — the input to the coarse
 *  `action` rollup (`coarseAction` in @coach/semantics). Non-shell tools use the
 *  same resolution `toolPhrases` does (`tool.action` after `overrides`); escape-hatch
 *  shell tools (Bash) resolve their command through the ontology's command grammar
 *  (`shellCommandAction`); MCP tools (`mcp__*`) resolve to `invoke`. Returns
 *  `undefined` only for a tool name with no spec at all (caller's rollup falls back
 *  to the ontology escape action). */
export function toolOntologyAction(
  config: SemanticsConfig,
  name: string | undefined,
  input: Record<string, unknown>,
): string | undefined {
  if (name?.startsWith(MCP_TOOL_PREFIX)) return 'invoke';
  const tool = toolSpecFor(config, name);
  if (tool == null) return undefined;
  if (tool.escapeHatch) return shellCommandAction(config, extractBashCommand(input) ?? undefined);
  return applyOverrides(tool.overrides, input, { action: tool.action }).action;
}

/** The agent's own intent annotation for a tool call, read verbatim from the
 *  per-agent-configured `commentField` (e.g. Bash `description`). Display only —
 *  never part of the closed `what` vocabulary. Undefined when unconfigured/empty. */
export function toolComment(
  config: SemanticsConfig,
  name: string | undefined,
  input: Record<string, unknown>,
): string | undefined {
  const field = (name != null ? config.agent.tools[name] : undefined)?.commentField;
  if (field == null) return undefined;
  const value = strField(input, field).trim();
  return value !== '' ? value : undefined;
}
