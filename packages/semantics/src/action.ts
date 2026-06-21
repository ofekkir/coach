// ════════════════════════════════════════════════════════════════════════════
// Canonical node ACTION — a CLOSED, deterministic dimension for analytics, kept
// deliberately SEPARATE from the free-form `semantics.what` ontology phrases.
//
// `what` is a rich, ordered, human-readable description ("fetch ynet.co.il",
// "summarize headlines"); it is open-ended and tuned per agent. `action` is the
// opposite: one value, drawn from a small fixed set, that buckets EVERY tool node
// into a coarse activity class so the store can `GROUP BY action` and get stable,
// comparable counts. It is a pure function of `(toolName, bashCommand?)` — no LLM,
// no config, no message context — so it is trivially reproducible: the same node
// always yields the same action, and reloading a fixture yields identical counts.
//
// Every tool node MUST resolve to a non-NULL action; `other` is the explicit
// catch-all, never NULL.
// ════════════════════════════════════════════════════════════════════════════

/** The closed action vocabulary. Order is documentation only. */
export const ACTIONS = [
  'explore', // read/search the workspace (Read, Grep, Glob, LS, NotebookRead)
  'author', // create new content (Write)
  'edit', // modify existing content (Edit, MultiEdit, NotebookEdit)
  'run', // execute a shell command with no more specific class
  'test', // run a test suite / test runner
  'verify', // typecheck / lint / format-check — non-test correctness gates
  'vcs', // version control (git, gh, jj, hg, svn)
  'setup', // install / build / scaffold the environment
  'mcp', // an MCP tool call (mcp__*)
  'research', // fetch/search the web (WebFetch, WebSearch)
  'delegate', // hand work to a sub-agent (Task)
  'plan', // planning tools (ExitPlanMode, TodoWrite)
  'other', // explicit catch-all — never NULL
] as const;

/** A canonical node action — one of the closed {@link ACTIONS} values. */
export type Action = (typeof ACTIONS)[number];

// ── Tool-name rule map (exact tool names) ───────────────────────────────────--
// A flat lookup, not nested ifs. A tool absent here falls through to the prefix
// rules and finally the `other` catch-all.
const TOOL_ACTIONS: Readonly<Record<string, Action>> = {
  Read: 'explore',
  Grep: 'explore',
  Glob: 'explore',
  LS: 'explore',
  NotebookRead: 'explore',
  Write: 'author',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  WebFetch: 'research',
  WebSearch: 'research',
  Task: 'delegate',
  ExitPlanMode: 'plan',
  TodoWrite: 'plan',
};

// Tools whose body is an arbitrary shell command — classified by the command.
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'run_command', 'shell']);

const MCP_TOOL_PREFIX = 'mcp__';

// ── Bash-command rule map (first matching rule wins, evaluated in order) ─────--
// Each rule tests the first significant token(s) of the command. Deterministic
// and documented; no command parsing beyond a normalized leading-token scan.
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

function bashAction(command: string | undefined): Action {
  const cmd = (command ?? '').trim();
  if (cmd === '') return 'run';
  const first = firstToken(cmd);
  if (PACKAGE_RUNNERS.has(first)) return packageRunnerAction(cmd);
  const rule = COMMAND_RULES.find((r) => r.test(first));
  return rule?.action ?? 'run';
}

/**
 * Maps a tool call to its closed {@link Action}. Pure and deterministic: depends
 * only on the tool name and — for shell tools — the bash command. MCP tools
 * (`mcp__*`) are `mcp`; known tools use the name lookup; shell tools are
 * classified by their command (git→vcs, test runners→test, build/install→setup,
 * lint/typecheck→verify, else→run); everything else falls through to `other`.
 */
export function classifyAction(toolName: string | undefined, bashCommand?: string): Action {
  const name = toolName ?? '';
  if (name.startsWith(MCP_TOOL_PREFIX)) return 'mcp';
  if (SHELL_TOOLS.has(name)) return bashAction(bashCommand);
  return TOOL_ACTIONS[name] ?? 'other';
}
