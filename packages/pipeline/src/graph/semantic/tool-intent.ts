import {
  actionLabel,
  objectLabel,
  strField,
  type CommandRule,
  type MatchClause,
  type SemanticsConfig,
  type ToolModifier,
  type ToolOverride,
  type ToolSemantics,
} from './config.ts';

// ════════════════════════════════════════════════════════════════════════════
// Tool & command intent — resolved entirely from config.agent.tools, the Bash
// command grammar, and config.project grounding. No hardcoded tool tables.
// ════════════════════════════════════════════════════════════════════════════

// ── Matching primitives ────────────────────────────────────────────────────────

/** A minimal glob→RegExp (browser-safe, no dependency): `**` spans path
 *  separators, `*` does not, `?` is one non-separator char. */
function globToRegExp(glob: string): RegExp {
  const escapeLiteral = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = glob
    .split('**')
    .map((spanSeg) =>
      spanSeg
        .split('*')
        .map((starSeg) => starSeg.split('?').map(escapeLiteral).join('[^/]'))
        .join('[^/]*'),
    )
    .join('.*');
  return new RegExp(`^${body}$`);
}

function matchClause(clause: MatchClause, input: Record<string, unknown>): boolean {
  const value = strField(input, clause.field);
  if (clause.equals != null) return value === clause.equals;
  if (clause.matches != null) return new RegExp(clause.matches, 'i').test(value);
  return false;
}

function matchCommand(rules: readonly CommandRule[], command: string): CommandRule | undefined {
  return rules.find((rule) => new RegExp(rule.match, 'i').test(command.trim()));
}

// ── Path grounding — basename + ontology object type ("Both" rendering) ────────

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function wellKnownLabel(config: SemanticsConfig, path: string): string | undefined {
  const rule = config.agent.wellKnownPaths?.rules.find((r) => new RegExp(r.match).test(path));
  return rule?.label;
}

function groundedType(config: SemanticsConfig, path: string): string | undefined {
  const rule = (config.project?.architecture.pathRules ?? []).find((r) =>
    globToRegExp(r.glob).test(path),
  );
  if (rule == null || rule.object === config.ontology.escape.object) return undefined;
  return objectLabel(config, rule.object);
}

/** "Both" style: well-known agent paths keep their semantic name alone; any
 *  other path renders `basename (grounded object type)` when grounding resolves
 *  to a non-escape type, else just the basename. */
function renderPathObject(config: SemanticsConfig, path: string): string {
  const known = wellKnownLabel(config, path);
  if (known != null) return known;
  const type = groundedType(config, path);
  return type != null ? `${basename(path)} (${type})` : basename(path);
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

/** Ordered action phrases for a tool call, resolved entirely from config. */
export function toolPhrases(
  config: SemanticsConfig,
  name: string | undefined,
  input: Record<string, unknown>,
): readonly string[] {
  const tool =
    (name != null ? config.agent.tools[name] : undefined) ?? config.agent.tools._unknownTool;
  if (tool == null) return [name != null && name !== '' ? name.toLowerCase() : 'tool'];
  // Escape-hatch tools (Bash, run_command) carry a freeform command — action and
  // object come from the project/agent command grammar, not the generic path.
  if (tool.escapeHatch && tool.target?.field != null) {
    return [commandPhrase(config, strField(input, tool.target.field))];
  }
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

/** Deterministic label for a Bash/shell command. This project's own scripts
 *  (project.commands) are checked first, then the domain ontology's universal
 *  command grammar (git, shell builtins, common tool runners — ending in a `.*`
 *  catch-all). With neither, falls back to the command's first word. */
function commandPhrase(config: SemanticsConfig, command: string): string {
  const hit =
    matchCommand(config.project?.commands.rules ?? [], command) ??
    matchCommand(config.ontology.commands?.rules ?? [], command);
  if (hit == null) return command.trim().split(/\s+/)[0] ?? 'command';
  return hit.label ?? actionLabel(config, hit.action);
}
