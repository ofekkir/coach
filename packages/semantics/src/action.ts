// ════════════════════════════════════════════════════════════════════════════
// Shell command grammar resolver — LOGIC only. The vocabulary and mappings are
// DATA in the ontology (see data/ontology/*.json): the shell `commands` grammar.
// This module just reads it.
//
// Escape-hatch tools (Bash) are the one surface with no per-tool spec: their command
// is classified by the ontology's `commands` grammar (`shellCommandAction`) into one
// ontology action id, whose `label` becomes the entry's `action` text (e.g.
// `git commit …` → "version control"). The ontology's escape action is the catch-all.
// ════════════════════════════════════════════════════════════════════════════

import type { SemanticsConfig } from './config.ts';

// ── Shell command grammar resolution (data lives in ontology.commands) ────────--

/** A leading `cd <path> &&` (or `;`) navigation prefix carries no intent — the
 *  substantive command is what follows. Strip it so the grammar classifies the real
 *  verb (`cd pkg && git commit` → `git commit`). */
function stripNavigationPrefix(command: string): string {
  const match = /^cd\s+\S+\s*(?:&&|;)\s*(.+)$/is.exec(command.trim());
  return match?.[1]?.trim() ?? command.trim();
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
 * returned id is an ontology action — its `label` becomes the entry's `action` text.
 */
export function shellCommandAction(config: SemanticsConfig, command: string | undefined): string {
  const grammar = config.ontology.commands;
  const cmd = stripNavigationPrefix(command ?? '');
  if (cmd === '') return grammar.default;
  const first = firstToken(cmd);
  if (grammar.runners.includes(first)) {
    const task = runnerTask(cmd);
    return grammar.taskRules.find((r) => r.match.includes(task))?.action ?? grammar.default;
  }
  return grammar.tokenRules.find((r) => r.match.includes(first))?.action ?? grammar.default;
}
