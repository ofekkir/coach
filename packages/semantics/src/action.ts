// Why: ACTION is resolver logic only — the vocabulary and every mapping are DATA in
// the ontology (data/ontology/*.json: the coarse bucket list, each fine action's
// `coarse` rollup, the shell `commands` grammar); this module just reads them.
// `action` is a CLOSED, coarse activity dimension for analytics (`GROUP BY action`),
// distinct from the free-form `semantics.what` — not a second taxonomy of tool calls
// but a coarsening of the ontology's own action vocabulary: the config layer resolves
// each tool call to one ontology action id, and `coarseAction` rolls that up via the
// action's `coarse` field. The one surface with no per-tool spec is shell escape-hatch
// tools (Bash): their command is classified by the ontology's `commands` grammar
// (`shellCommandAction`) into an ontology action, then rolled up the same way. Every
// tool node resolves to a non-NULL bucket; the ontology's escape action is the catch-all.

import type { SemanticsConfig } from './config.ts';

/**
 * Rolls an ontology action id up to its coarse bucket, read from the action's
 * `coarse` field in the ontology. An unknown/`undefined` id falls back to the
 * coarse bucket of the ontology's escape action — never NULL.
 */
export function coarseAction(
  config: SemanticsConfig,
  ontologyActionId: string | undefined,
): string {
  const byId = (id: string | undefined): string | undefined =>
    config.ontology.actions.find((a) => a.id === id)?.coarse;
  return byId(ontologyActionId) ?? byId(config.ontology.escape.action) ?? 'other';
}

function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? '';
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

/**
 * Maps a shell command to its ontology action id via `ontology.commands`: a package
 * runner (`pnpm`/`npm`/…) is classified by its script task, any other command by its
 * leading token; an unmatched or empty command yields the grammar's `default`. The
 * returned id is an ontology action — feed it to {@link coarseAction} for the bucket.
 */
export function shellCommandAction(config: SemanticsConfig, command: string | undefined): string {
  const grammar = config.ontology.commands;
  const cmd = (command ?? '').trim();
  if (cmd === '') return grammar.default;
  const first = firstToken(cmd);
  if (grammar.runners.includes(first)) {
    const task = runnerTask(cmd);
    return grammar.taskRules.find((r) => r.match.includes(task))?.action ?? grammar.default;
  }
  return grammar.tokenRules.find((r) => r.match.includes(first))?.action ?? grammar.default;
}
