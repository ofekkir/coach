import { z } from 'zod';

// ════════════════════════════════════════════════════════════════════════════
// Semantics configuration — the typed, validated form of the config/ artifacts
// (ontology/<domain>.json, agents/<agent>.json, projects/<project>.json). Zod
// schemas are the source of truth for the shapes; the exported types are
// inferred from them, and the data is validated when loaded from disk (unknown
// keys such as `note`/`description`/`schemaVersion` are stripped, not errors).
//
// The pipeline stays pure: it never reads these from disk. A Node caller parses
// the JSON and passes it to assembleSemanticsConfig(), which validates each file
// and enforces that every action/object id resolves against the ontology.
// ════════════════════════════════════════════════════════════════════════════

// ── Domain ontology (the vocabulary source of truth) ───────────────────────────

const OntologyActionSchema = z.object({
  id: z.string(),
  group: z.enum(['work', 'meta', 'harness', 'escape']),
  label: z.string(),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
});

const OntologyObjectSchema = z.object({
  id: z.string(),
  label: z.string(),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
});

const MessageActSchema = z.object({ verb: z.string(), hint: z.string().optional() });

// A command→action rule, shared by the domain ontology (universal commands) and
// project grounding (this project's own scripts). First match wins.
const CommandRuleSchema = z.object({
  match: z.string(),
  action: z.string(),
  object: z.string().optional(),
  label: z.string().optional(),
});

const OntologySchema = z.object({
  id: z.string(),
  actions: z.array(OntologyActionSchema),
  objects: z.array(OntologyObjectSchema),
  escape: z.object({ action: z.string(), object: z.string() }),
  messageActs: z.object({ verbs: z.array(MessageActSchema) }).optional(),
  commands: z.object({ rules: z.array(CommandRuleSchema) }).optional(),
});

// ── Agent tool semantics ───────────────────────────────────────────────────────

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

// ── Project grounding ───────────────────────────────────────────────────────────

const PathRuleSchema = z.object({
  glob: z.string(),
  object: z.string(),
  label: z.string().optional(),
  component: z.string().optional(),
});

const ProjectGroundingSchema = z.object({
  id: z.string(),
  ontology: z.string(),
  architecture: z.object({ pathRules: z.array(PathRuleSchema) }),
  commands: z.object({ rules: z.array(CommandRuleSchema) }),
});

// ── Inferred types ──────────────────────────────────────────────────────────--

export type Ontology = z.infer<typeof OntologySchema>;
export type OntologyAction = z.infer<typeof OntologyActionSchema>;
export type MessageAct = z.infer<typeof MessageActSchema>;
export type AgentSemantics = z.infer<typeof AgentSemanticsSchema>;
export type ProjectGrounding = z.infer<typeof ProjectGroundingSchema>;
export type MatchClause = z.infer<typeof MatchClauseSchema>;
export type ToolOverride = z.infer<typeof ToolOverrideSchema>;
export type ToolModifier = z.infer<typeof ToolModifierSchema>;
export type ToolSemantics = z.infer<typeof ToolSemanticsSchema>;
export type CommandRule = z.infer<typeof CommandRuleSchema>;

export interface SemanticsConfig {
  ontology: Ontology;
  agent: AgentSemantics;
  project?: ProjectGrounding;
}

// ── Shared pure helpers ─────────────────────────────────────────────────────--

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

// ── Assembly + referential-integrity validation ────────────────────────────────

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

function assertRefsResolve(
  ontology: Ontology,
  agent: AgentSemantics,
  project?: ProjectGrounding,
): void {
  const actions = new Set(ontology.actions.map((a) => a.id));
  const objects = new Set(ontology.objects.map((o) => o.id));
  const actionRefs: string[] = [];
  const objectRefs: string[] = [];
  collectRefs([agent, project], 'action', actionRefs);
  collectRefs([agent, project], 'object', objectRefs);
  const unknownActions = [...new Set(actionRefs)].filter((id) => !actions.has(id));
  const unknownObjects = [...new Set(objectRefs)].filter((id) => !objects.has(id));
  if (unknownActions.length > 0 || unknownObjects.length > 0) {
    throw new Error(
      `semantics config references ids absent from ontology '${ontology.id}': ` +
        `actions=[${unknownActions.join(', ')}] objects=[${unknownObjects.join(', ')}]`,
    );
  }
}

/**
 * Validates the raw ontology / agent / project JSON against their schemas and
 * enforces that every action/object id they reference is defined in the ontology
 * — the contract that keeps the files from drifting into unaggregatable labels.
 * Throws (Zod or referential-integrity error) on any violation.
 */
export function assembleSemanticsConfig(
  rawOntology: unknown,
  rawAgent: unknown,
  rawProject?: unknown,
): SemanticsConfig {
  const ontology = OntologySchema.parse(rawOntology);
  const agent = AgentSemanticsSchema.parse(rawAgent);
  const project = rawProject != null ? ProjectGroundingSchema.parse(rawProject) : undefined;
  assertRefsResolve(ontology, agent, project);
  return project != null ? { ontology, agent, project } : { ontology, agent };
}
