import {
  actionLabel,
  coarseAction,
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
import type { SemanticEntry } from '../../types.ts';

import { extractBashCommand } from './derive.ts';

// ════════════════════════════════════════════════════════════════════════════
// Tool & command intent — resolved entirely from config.agent.tools and the
// ontology's command grammar + path/structure conventions. No hardcoded tool tables.
//
// Every tool call resolves to one or more `SemanticEntry`: a STATIC, input-
// independent label (the act with the specific argument stripped, so every "load a
// tool schema" reads the same) plus the structured argument it acted on — `rawPath`
// (a file path, grounded to `repoPath`/`package` in stage 7), `url` (a web host), and
// the coarse `action` bucket. The input never leaks back into `static`.
// ════════════════════════════════════════════════════════════════════════════

// ── Matching primitives ────────────────────────────────────────────────────────

function matchClause(clause: MatchClause, input: Record<string, unknown>): boolean {
  const value = strField(input, clause.field);
  if (clause.equals != null) return value === clause.equals;
  if (clause.matches != null) return new RegExp(clause.matches, 'i').test(value);
  return false;
}

// ── Path grounding — convention object type (never the specific basename) ──────

function wellKnownLabel(config: SemanticsConfig, path: string): string | undefined {
  const rule = config.agent.wellKnownPaths?.rules.find((r) => new RegExp(r.match).test(path));
  return rule?.label;
}

/** The ontology object label a path resolves to via the generic file-role
 *  conventions (first match wins). Undefined when nothing matches or the match is
 *  the escape object — caller falls back to the generic escape label. */
function groundedType(config: SemanticsConfig, path: string): string | undefined {
  const rules = config.ontology.conventions?.paths.rules ?? [];
  const rule = rules.find((r) => new RegExp(r.match, 'i').test(path));
  if (rule == null || rule.object === config.ontology.escape.object) return undefined;
  return objectLabel(config, rule.object);
}

/** The STATIC object type a path renders to: a well-known agent path keeps its
 *  semantic name, otherwise the convention object type (`source code`). The specific
 *  basename is NEVER folded in — it lives on `rawPath`. Unknown → the escape object
 *  label, so the gap is visible rather than silently dropped. */
function staticPathObject(config: SemanticsConfig, rawPath: string): string {
  const path = stripWorktreeSegment(rawPath);
  return (
    wellKnownLabel(config, path) ??
    groundedType(config, path) ??
    objectLabel(config, config.ontology.escape.object)
  );
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

// The structured argument a tool acted on, captured for the entry's context. A
// `path` target yields the raw (un-normalized) path — stage 7 grounds it to a
// repo_path; a `host` target yields the URL host. Literal/none targets carry nothing:
// the argument is intentionally dropped from the static model.
function targetContext(
  tool: ToolSemantics,
  input: Record<string, unknown>,
): Pick<SemanticEntry, 'rawPath' | 'url'> {
  const spec = tool.target;
  if (spec?.field == null) return {};
  const raw = strField(input, spec.field).trim();
  if (raw === '') return {};
  if (spec.kind === 'path') return { rawPath: raw };
  if (spec.kind === 'host') return { url: hostOf(raw) };
  return {};
}

function fillStaticPhrase(template: string, parts: { object: string; toolName: string }): string {
  return template
    .replaceAll('{target}', '')
    .replaceAll('{object}', parts.object)
    .replaceAll('{toolNameLower}', parts.toolName.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
}

/** The STATIC base label for a tool call: an explicit `label`, else the tool's
 *  phrase template with the argument stripped and `{object}` filled by the static
 *  object type, else `action object`. Never contains the specific input. */
function staticLabel(
  config: SemanticsConfig,
  name: string,
  tool: ToolSemantics,
  resolved: Resolved,
  input: Record<string, unknown>,
): string {
  if (resolved.label != null) return resolved.label;
  const object = staticObject(config, tool, resolved, input);
  if (resolved.phrase != null) return fillStaticPhrase(resolved.phrase, { object, toolName: name });
  return `${actionLabel(config, resolved.action)} ${object}`.trim();
}

/** The static object type for a tool's phrase `{object}` slot: a path target grounds
 *  to its convention type, otherwise the tool's declared object label (empty when
 *  none — phrases without an `{object}` slot never read it). */
function staticObject(
  config: SemanticsConfig,
  tool: ToolSemantics,
  resolved: Resolved,
  input: Record<string, unknown>,
): string {
  const spec = tool.target;
  if (spec?.kind === 'path' && spec.field != null) {
    const raw = strField(input, spec.field).trim();
    if (raw !== '') return staticPathObject(config, raw);
  }
  return resolved.object != null ? objectLabel(config, resolved.object) : '';
}

function modifierEntries(
  config: SemanticsConfig,
  modifiers: readonly ToolModifier[] | undefined,
  input: Record<string, unknown>,
): SemanticEntry[] {
  return (modifiers ?? [])
    .filter((m) => matchClause(m.when, input))
    .map((m) => ({
      static: m.append.label,
      ...(m.append.action != null ? { action: coarseAction(config, m.append.action) } : {}),
    }));
}

const MCP_TOOL_PREFIX = 'mcp__';

/** The agent's configured tool spec for a tool name, falling back to the
 *  `_unknownTool` catch-all. Undefined only when neither is configured. */
function toolSpecFor(config: SemanticsConfig, name: string | undefined): ToolSemantics | undefined {
  return (name != null ? config.agent.tools[name] : undefined) ?? config.agent.tools._unknownTool;
}

/** The single ontology action id a tool call resolves to — the input to the coarse
 *  `action` rollup. Non-shell tools use `tool.action` after `overrides`; escape-hatch
 *  shell tools (Bash) resolve their command through the ontology's command grammar;
 *  MCP tools (`mcp__*`) resolve to `invoke`. Returns `undefined` only for a tool name
 *  with no spec at all (rollup then falls back to the ontology escape action). */
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

/** The escape-hatch (shell) entry: the STATIC label of the ontology action the
 *  wrapped command resolves to (`git commit …` → "version control", `pnpm test …` →
 *  "run tests", an unclassified command → the generic "run"). The specific program /
 *  arguments are intentionally NOT in the label. */
function escapeHatchEntry(config: SemanticsConfig, input: Record<string, unknown>): SemanticEntry {
  const ontologyAction = shellCommandAction(config, extractBashCommand(input) ?? undefined);
  return {
    static: actionLabel(config, ontologyAction),
    action: coarseAction(config, ontologyAction),
  };
}

/** Ordered semantic entries for a tool call, resolved entirely from config: a base
 *  entry (static label + coarse action + the structured argument it touched) followed
 *  by any matching modifier entries. */
export function toolEntries(
  config: SemanticsConfig,
  name: string | undefined,
  input: Record<string, unknown>,
): SemanticEntry[] {
  const tool = toolSpecFor(config, name);
  if (tool == null) return [{ static: name != null && name !== '' ? name.toLowerCase() : 'tool' }];
  if (tool.escapeHatch) return [escapeHatchEntry(config, input)];
  const resolved = applyOverrides(tool.overrides, input, {
    action: tool.action,
    object: tool.object,
    phrase: tool.phrase,
  });
  const base: SemanticEntry = {
    static: staticLabel(config, name ?? '', tool, resolved, input),
    action: coarseAction(config, toolOntologyAction(config, name, input)),
    ...targetContext(tool, input),
  };
  return [base, ...modifierEntries(config, tool.modifiers, input)];
}

/** The agent's own intent annotation for a tool call, read verbatim from the
 *  per-agent-configured `commentField` (e.g. Bash `description`). Display only —
 *  never part of the closed `static` vocabulary. Undefined when unconfigured/empty. */
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
