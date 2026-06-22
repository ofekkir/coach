import { z } from 'zod';

/*
 * Semantics configuration — the typed, validated form of the bundled artifacts
 * in ./data (ontology/<domain>.json, agents/<agent>.json, projects/<project>.json).
 * Zod schemas are the source of truth for the shapes; the exported types are
 * inferred from them, and the data is validated on assembly (unknown keys such as
 * `note`/`description`/`schemaVersion` are stripped, not errors).
 *
 * This module is pure: the JSON is imported (bundled), never read from disk.
 * `defaults.ts` passes the bundled JSON to assembleSemanticsConfig(), which
 * validates each artifact and enforces that every action/object id resolves
 * against the ontology. The pipeline consumes the assembled SemanticsConfig.
 */

const OntologyActionSchema = z.object({
  id: z.string(),
  group: z.enum(['work', 'meta', 'harness', 'escape']),
  // Why: the coarse analytics bucket this fine action rolls up to (a `coarseActions`
  // id). Closed activity dimension for `GROUP BY`, distinct from the rich `what`.
  coarse: z.string(),
  label: z.string(),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
});

// Why: shell command grammar — the one classification surface with no per-tool spec.
// A leading token (or, for package runners, the script task) maps to an ontology
// action id; that action's `coarse` then gives the bucket. Lives in the ontology
// because git/pytest/pnpm are domain knowledge, not per-agent configuration.
const CommandRuleSchema = z.object({ match: z.array(z.string()), action: z.string() });
const CommandsSchema = z.object({
  runners: z.array(z.string()),
  tokenRules: z.array(CommandRuleSchema),
  taskRules: z.array(CommandRuleSchema),
  default: z.string(),
});

const OntologyObjectSchema = z.object({
  id: z.string(),
  label: z.string(),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
});

const MessageActSchema = z.object({ verb: z.string(), hint: z.string().optional() });

// Why: conventions are transferable domain knowledge, not project-specific — a
// file's role from its name/path, and a structural qualifier (e.g. the monorepo
// workspace) from generic layout patterns. Both use regex `match`, first hit wins.
const ConventionPathRuleSchema = z.object({ match: z.string(), object: z.string() });
const ConventionStructureRuleSchema = z.object({ match: z.string(), qualifier: z.string() });

const OntologySchema = z.object({
  id: z.string(),
  actions: z.array(OntologyActionSchema),
  coarseActions: z.array(z.string()),
  commands: CommandsSchema,
  objects: z.array(OntologyObjectSchema),
  escape: z.object({ action: z.string(), object: z.string() }),
  conventions: z
    .object({
      paths: z.object({ rules: z.array(ConventionPathRuleSchema) }),
      structure: z.object({ rules: z.array(ConventionStructureRuleSchema) }).optional(),
    })
    .optional(),
  messageActs: z.object({ verbs: z.array(MessageActSchema) }).optional(),
});

const MatchClauseSchema = z.object({
  field: z.string(),
  equals: z.string().optional(),
  matches: z.string().optional(),
});

const TargetSpecSchema = z.object({
  field: z.string().optional(),
  kind: z.enum(['path', 'host', 'literal', 'none']),
  extract: z.string().optional(),
});

const ToolOverrideSchema = z.object({
  when: MatchClauseSchema,
  action: z.string().optional(),
  object: z.string().optional(),
  label: z.string().optional(),
  phrase: z.string().optional(),
});

const ToolModifierSchema = z.object({
  when: MatchClauseSchema,
  append: z.object({ action: z.string().optional(), label: z.string() }),
});

const ToolSemanticsSchema = z.object({
  action: z.string().optional(),
  object: z.string().optional(),
  target: TargetSpecSchema.optional(),
  phrase: z.string().optional(),
  fallbackPhrase: z.string().optional(),
  escapeHatch: z.boolean().optional(),
  overrides: z.array(ToolOverrideSchema).optional(),
  modifiers: z.array(ToolModifierSchema).optional(),
  /** Input field carrying the agent's own intent annotation (e.g. Bash
   *  `description`), surfaced verbatim as the node's `comment`. Display only. */
  commentField: z.string().optional(),
});

const WellKnownPathSchema = z.object({ match: z.string(), label: z.string() });

const MarkerRuleSchema = z.object({
  id: z.string(),
  when: z.object({
    responseJsonHasStringKey: z.string().optional(),
    requestTextStartsWith: z.string().optional(),
  }),
  action: z.string(),
  object: z.string().optional(),
});

const StructuralRoleRuleSchema = z.object({
  id: z.string(),
  when: z.object({
    responseHasBlockType: z.string().optional(),
    responseEndsWithBlockType: z.string().optional(),
  }),
  action: z.string(),
  phrase: z.string(),
  overrides: z
    .array(z.object({ when: z.object({ toolName: z.string() }), phrase: z.string() }))
    .optional(),
});

const AgentSemanticsSchema = z.object({
  id: z.string(),
  ontology: z.string(),
  tools: z.record(z.string(), ToolSemanticsSchema),
  wellKnownPaths: z.object({ rules: z.array(WellKnownPathSchema) }).optional(),
  markers: z.object({ rules: z.array(MarkerRuleSchema) }),
  structuralRoles: z.object({ rules: z.array(StructuralRoleRuleSchema) }),
});

export type Ontology = z.infer<typeof OntologySchema>;
export type OntologyAction = z.infer<typeof OntologyActionSchema>;
export type MessageAct = z.infer<typeof MessageActSchema>;
export type AgentSemantics = z.infer<typeof AgentSemanticsSchema>;
export type MatchClause = z.infer<typeof MatchClauseSchema>;
export type ToolOverride = z.infer<typeof ToolOverrideSchema>;
export type ToolModifier = z.infer<typeof ToolModifierSchema>;
export type ToolSemantics = z.infer<typeof ToolSemanticsSchema>;
export interface SemanticsConfig {
  ontology: Ontology;
  agent: AgentSemantics;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function strField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === 'string' ? value : '';
}

export function actionLabel(config: SemanticsConfig, id: string | undefined): string {
  if (id == null) return '';
  return config.ontology.actions.find((a) => a.id === id)?.label ?? id;
}

export function objectLabel(config: SemanticsConfig, id: string | undefined): string {
  if (id == null) return '';
  return config.ontology.objects.find((o) => o.id === id)?.label ?? id;
}

function collectRefs(value: unknown, kind: 'action' | 'object', out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, kind, out);
    return;
  }
  if (!isRecord(value)) return;
  const ref = value[kind];
  if (typeof ref === 'string') out.push(ref);
  for (const key of Object.keys(value)) collectRefs(value[key], kind, out);
}

function assertRefsResolve(ontology: Ontology, agent: AgentSemantics): void {
  const actions = new Set(ontology.actions.map((a) => a.id));
  const objects = new Set(ontology.objects.map((o) => o.id));
  const actionRefs: string[] = [];
  const objectRefs: string[] = [];
  const refSources = [agent, ontology.conventions];
  collectRefs(refSources, 'action', actionRefs);
  collectRefs(refSources, 'object', objectRefs);
  const unknownActions = [...new Set(actionRefs)].filter((id) => !actions.has(id));
  const unknownObjects = [...new Set(objectRefs)].filter((id) => !objects.has(id));
  if (unknownActions.length > 0 || unknownObjects.length > 0) {
    throw new Error(
      `semantics config references ids absent from ontology '${ontology.id}': ` +
        `actions=[${unknownActions.join(', ')}] objects=[${unknownObjects.join(', ')}]`,
    );
  }
}

// Why: every action's `coarse` must be a declared `coarseActions` id, and every command
// rule (plus the default) must resolve to an ontology action id — so the closed
// `action` dimension and the shell grammar cannot drift into unaggregatable values.
function assertActionVocabulary(ontology: Ontology): void {
  const coarse = new Set(ontology.coarseActions);
  const actions = new Set(ontology.actions.map((a) => a.id));
  const badCoarse = ontology.actions.filter((a) => !coarse.has(a.coarse)).map((a) => a.id);
  const ruleActions = [...ontology.commands.tokenRules, ...ontology.commands.taskRules].map(
    (r) => r.action,
  );
  const badCommands = [...ruleActions, ontology.commands.default].filter((id) => !actions.has(id));
  if (badCoarse.length > 0 || badCommands.length > 0) {
    throw new Error(
      `ontology '${ontology.id}' has unresolvable vocabulary: ` +
        `actions with unknown coarse=[${badCoarse.join(', ')}] ` +
        `command rules with unknown action=[${[...new Set(badCommands)].join(', ')}]`,
    );
  }
}

/**
 * Validates the raw ontology and agent JSON against their schemas and enforces
 * that every action/object id the agent (and the ontology's own conventions)
 * reference is defined in the ontology — the contract that keeps the files from
 * drifting into unaggregatable labels. Throws (Zod or referential-integrity
 * error) on any violation.
 */
export function assembleSemanticsConfig(rawOntology: unknown, rawAgent: unknown): SemanticsConfig {
  const ontology = OntologySchema.parse(rawOntology);
  const agent = AgentSemanticsSchema.parse(rawAgent);
  assertRefsResolve(ontology, agent);
  assertActionVocabulary(ontology);
  return { ontology, agent };
}
