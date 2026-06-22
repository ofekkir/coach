// ════════════════════════════════════════════════════════════════════════════
// Canonical node ACTION — a CLOSED, deterministic dimension for analytics, kept
// deliberately SEPARATE from the free-form `semantics.what` ontology phrases.
//
// `what` is a rich, ordered, human-readable description ("fetch ynet.co.il",
// "summarize headlines"); it is open-ended and tuned per agent. `action` is the
// opposite: ONE value, drawn from a small fixed set, that buckets EVERY tool node
// into a coarse activity class so the store can `GROUP BY action` and get stable,
// comparable counts.
//
// `action` is NOT a second taxonomy of tool calls — it is a fixed COARSENING of
// the ontology's own (finer) action vocabulary. The config layer already resolves
// every tool call to one ontology action id (Read→`read`, Write→`write`, …); this
// module's `ACTION_GROUP` rolls those ~30 fine ids up into ~13 coarse buckets, so
// there is one classification source of truth (the ontology mapping), not two.
// `coarseAction` is the rollup; `bashAction` is the one piece with NO ontology
// twin — shell escape-hatch tools (Bash) carry an arbitrary command the config
// deliberately does not classify, so the command-grammar rules live here.
//
// The coarse vocabulary is GLOBAL and agent-invariant on purpose: an agent may
// remap a tool to a different ontology action, but the coarse bucket map does not
// move, so counts stay comparable across agents. Every tool node MUST resolve to a
// non-NULL action; `other` is the explicit catch-all, never NULL.
// ════════════════════════════════════════════════════════════════════════════

/** The closed action vocabulary. Order is documentation only. */
export const ACTIONS = [
  'explore', // read/search the workspace (ontology: read, search, review)
  'author', // create new content (ontology: write)
  'edit', // modify existing content (ontology: edit, delete, refactor)
  'run', // execute a command with no more specific class (ontology: run, debug)
  'test', // run a test suite / test runner (ontology: test)
  'verify', // typecheck / lint / format-check (ontology: lint, format, typecheck, verify)
  'vcs', // version control (ontology: vcs)
  'setup', // install / build / scaffold the environment (ontology: build, configure)
  'mcp', // an MCP tool call (ontology: invoke)
  'research', // fetch/search the web (ontology: fetch, search-web)
  'delegate', // hand work to a sub-agent / skill (ontology: delegate, use-skill)
  'plan', // planning tools (ontology: plan)
  'other', // explicit catch-all — never NULL
] as const;

/** A canonical node action — one of the closed {@link ACTIONS} values. */
export type Action = (typeof ACTIONS)[number];

// ── Ontology-action → coarse-action rollup ──────────────────────────────────--
// A TOTAL map over the coding ontology's action ids. Kept here (not in the per-
// agent config) so the coarse buckets stay global and comparable; a test asserts
// it covers every ontology action id, so adding an ontology action without a
// bucket fails CI rather than silently falling through to `other`.
export const ACTION_GROUP: Readonly<Record<string, Action>> = {
  read: 'explore',
  search: 'explore',
  review: 'explore',
  write: 'author',
  edit: 'edit',
  delete: 'edit',
  refactor: 'edit',
  run: 'run',
  debug: 'run',
  build: 'setup',
  configure: 'setup',
  test: 'test',
  lint: 'verify',
  format: 'verify',
  typecheck: 'verify',
  verify: 'verify',
  vcs: 'vcs',
  fetch: 'research',
  'search-web': 'research',
  plan: 'plan',
  invoke: 'mcp',
  delegate: 'delegate',
  'use-skill': 'delegate',
  respond: 'other',
  clarify: 'other',
  'generate-title': 'other',
  predict: 'other',
  'load-schema': 'other',
  act: 'other',
};

/**
 * Rolls an ontology action id up to its coarse {@link Action} bucket. An id absent
 * from {@link ACTION_GROUP} (or `undefined`) yields `other` — never NULL. This is
 * the primary path: the config layer resolves a tool call to its ontology action,
 * and this collapses that to the comparable coarse dimension.
 */
export function coarseAction(ontologyActionId: string | undefined): Action {
  if (ontologyActionId == null) return 'other';
  return ACTION_GROUP[ontologyActionId] ?? 'other';
}

// ── Bash-command classifier — the one rule set with NO ontology twin ─────────--
// Shell escape-hatch tools (Bash, run_command, shell) wrap an arbitrary command
// the config layer labels by tool name only (escapeHatch). The command-grammar
// below is therefore the SOLE place git→vcs / pytest→test / build→setup live; it
// is not duplicated anywhere in config. First matching rule wins, evaluated in
// order, on a normalized leading-token scan (no full command parsing).
interface CommandRule {
  readonly action: Action;
  readonly test: (firstToken: string) => boolean;
}

const VCS_COMMANDS: ReadonlySet<string> = new Set(['git', 'gh', 'jj', 'hg', 'svn']);
const TEST_COMMANDS: ReadonlySet<string> = new Set([
  'pytest',
  'jest',
  'vitest',
  'mocha',
  'rspec',
  'phpunit',
]);
const SETUP_COMMANDS: ReadonlySet<string> = new Set([
  'make',
  'cmake',
  'gradle',
  'mvn',
  'bundle',
  'pip',
  'pip3',
  'poetry',
  'brew',
  'apt',
  'apt-get',
  'docker',
]);
const VERIFY_TASKS: ReadonlySet<string> = new Set([
  'lint',
  'format',
  'format:check',
  'typecheck',
  'tsc',
  'check',
  'eslint',
  'prettier',
]);
const TEST_TASKS: ReadonlySet<string> = new Set(['test', 'test:watch']);
const SETUP_TASKS: ReadonlySet<string> = new Set(['install', 'ci', 'build', 'add', 'create']);

// Package-runner verbs (pnpm/npm/yarn/npx run …) classified by their script name.
const PACKAGE_RUNNERS: ReadonlySet<string> = new Set(['pnpm', 'npm', 'yarn', 'npx', 'bun', 'pnpx']);

function packageRunnerAction(command: string): Action {
  const task = runnerTask(command);
  if (TEST_TASKS.has(task)) return 'test';
  if (VERIFY_TASKS.has(task)) return 'verify';
  if (SETUP_TASKS.has(task)) return 'setup';
  return 'run';
}

/** The script/subcommand a package-runner invokes, ignoring the optional `run`
 *  verb (`pnpm run test` → `test`, `npm test` → `test`, `pnpm install` → `install`). */
function runnerTask(command: string): string {
  const tokens = command.split(/\s+/).filter((t) => t !== '');
  const rest = tokens.slice(1);
  const head = rest[0];
  if (head === 'run' || head === 'run-script' || head === 'exec') return rest[1] ?? '';
  return head ?? '';
}

const COMMAND_RULES: readonly CommandRule[] = [
  { action: 'vcs', test: (first) => VCS_COMMANDS.has(first) },
  { action: 'test', test: (first) => TEST_COMMANDS.has(first) },
  { action: 'setup', test: (first) => SETUP_COMMANDS.has(first) },
];

function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? '';
}

/**
 * Classifies a shell command into its coarse {@link Action} (git→vcs, test
 * runners→test, build/install→setup, package-runner scripts by their task,
 * else→run). Pure and deterministic. An empty command is `run`.
 */
export function bashAction(command: string | undefined): Action {
  const cmd = (command ?? '').trim();
  if (cmd === '') return 'run';
  const first = firstToken(cmd);
  if (PACKAGE_RUNNERS.has(first)) return packageRunnerAction(cmd);
  const rule = COMMAND_RULES.find((r) => r.test(first));
  return rule?.action ?? 'run';
}
