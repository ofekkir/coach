// ════════════════════════════════════════════════════════════════════════════
// Semantics configuration — the typed, injected form of the config/ artifacts
// (ontology/coding.json, agents/<agent>.json, projects/<project>.json). The
// pipeline stays pure: it never reads these from disk. The Node CLI parses the
// JSON and calls assembleSemanticsConfig(); the browser would inject the same
// shape. derive.ts interprets this config in place of the old hardcoded tables.
// ════════════════════════════════════════════════════════════════════════════

// ── Domain ontology (the vocabulary source of truth) ───────────────────────────

type ActionGroup = 'work' | 'meta' | 'harness' | 'escape';

export interface OntologyAction {
  id: string;
  group: ActionGroup;
  label: string;
  aliases?: readonly string[];
  description?: string;
}

interface OntologyObject {
  id: string;
  label: string;
  aliases?: readonly string[];
  description?: string;
}

/** A terminal-message act verb — a distinct axis from leaf `actions`, used only
 *  by the model-residual prompt (label-batch), not the deterministic interpreter. */
export interface MessageAct {
  verb: string;
  hint?: string;
}

export interface Ontology {
  id: string;
  actions: readonly OntologyAction[];
  objects: readonly OntologyObject[];
  escape: { action: string; object: string };
  messageActs?: { verbs: readonly MessageAct[] };
}

// ── Agent tool semantics ───────────────────────────────────────────────────────

type TargetKind = 'path' | 'host' | 'literal' | 'none';

interface TargetSpec {
  field?: string;
  kind: TargetKind;
  extract?: string;
}

export interface MatchClause {
  field: string;
  equals?: string;
  matches?: string;
}

export interface ToolOverride {
  when: MatchClause;
  action?: string;
  object?: string;
  label?: string;
  phrase?: string;
}

export interface ToolModifier {
  when: MatchClause;
  append: { action?: string; label: string };
}

export interface ToolSemantics {
  action?: string;
  object?: string;
  target?: TargetSpec;
  phrase?: string;
  fallbackPhrase?: string;
  escapeHatch?: boolean;
  grammarRef?: string;
  overrides?: readonly ToolOverride[];
  modifiers?: readonly ToolModifier[];
  /** Input field carrying the agent's own intent annotation (e.g. Bash
   *  `description`), surfaced verbatim as the node's `comment`. Display only. */
  commentField?: string;
}

/** A well-known path the *agent* owns (e.g. ~/.claude/settings.json). First
 *  regex match wins; the label is the full semantic name (no grounded suffix). */
interface WellKnownPath {
  match: string;
  label: string;
}

export interface CommandRule {
  match: string;
  action: string;
  object?: string;
  label?: string;
}

interface MarkerRule {
  id: string;
  when: { responseJsonHasStringKey?: string; requestTextStartsWith?: string };
  action: string;
  object?: string;
}

interface StructuralRoleRule {
  id: string;
  when: { responseHasBlockType?: string; responseEndsWithBlockType?: string };
  action: string;
  phrase: string;
  overrides?: readonly { when: { toolName: string }; phrase: string }[];
}

export interface AgentSemantics {
  id: string;
  ontology: string;
  tools: Record<string, ToolSemantics>;
  wellKnownPaths?: { rules: readonly WellKnownPath[] };
  bashCommandGrammar: { rules: readonly CommandRule[] };
  markers: { rules: readonly MarkerRule[] };
  structuralRoles: { rules: readonly StructuralRoleRule[] };
}

// ── Project grounding ───────────────────────────────────────────────────────────

interface PathRule {
  glob: string;
  object: string;
  label?: string;
  component?: string;
}

export interface ProjectGrounding {
  id: string;
  ontology: string;
  architecture: { pathRules: readonly PathRule[] };
  commands: { rules: readonly CommandRule[] };
}

// ── Assembled, validated config injected into the pipeline ─────────────────────

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

// ── Assembly + referential-integrity validation (config/README.md, artifact 5) ──

function collectRefs(value: unknown, kind: 'action' | 'object', out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, kind, out);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  const ref = record[kind];
  if (typeof ref === 'string') out.push(ref);
  for (const key of Object.keys(record)) collectRefs(record[key], kind, out);
}

/** Throws when an agent/project file references an action or object id that the
 *  ontology does not define — the contract that keeps the three files from
 *  drifting into unaggregatable labels. */
export function assembleSemanticsConfig(
  ontology: Ontology,
  agent: AgentSemantics,
  project?: ProjectGrounding,
): SemanticsConfig {
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
  return project != null ? { ontology, agent, project } : { ontology, agent };
}
