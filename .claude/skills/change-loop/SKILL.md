---
name: change-loop
description: >-
  The optimized inner loop for changing code in this repo — explore → edit/author →
  run → verify → commit — tuned to avoid the friction this repo's own traces show
  (read-before-edit failures, redundant tool calls, end-of-turn batched checks,
  worktree fallbacks, commit-without-gate). Use for any "implement/fix/refactor X",
  "add a file", "change this module", or "build feature" request that ends in a
  commit or PR. Skip for pure Q&A, read-only investigation, or one-off shell runs.
---

# The change loop

Changing code is ~73% of this repo's measured agent time, and it cycles
`explore → edit → run → verify` 20–58 tool calls per turn. Small per-cycle waste
compounds. This skill is the optimized path plus the specific traps coach traces
show actually biting in this repo.

## The loop

1. **Orient before touching anything.** Read `ARCHITECTURE.md` if the task is
   structural. Locate the real edit sites with **one** broad search (Grep/Glob or
   an `Explore` agent), not a sequence of narrowing greps.
2. **Read every file you will edit, fully, immediately before editing it.** The
   Edit tool refuses to write a file you haven't read this session, and any
   file-mutating Bash (`sed`/`perl`/`git mv`/`rm`) silently invalidates a prior
   read. Re-read after such commands.
3. **Author / edit.** Batch independent edits in one turn; don't ping-pong
   edit→run→edit on the same file when the edits are independent.
4. **Run once, late.** Run the narrowest check that proves the change
   (`pnpm test <file>` or `pnpm typecheck`), not the full suite after every edit.
5. **Verify against the goal**, then **gate the commit** behind `pnpm check`.
6. **Branch + PR. Never commit to `main`.** Open the PR and stop — the maintainer
   approves and merges every PR himself.

## Non-negotiable traps (each is a logged, repeated failure in this repo)

- **Read-before-edit, every time.** The single largest preventable error bucket is
  editing a stale/unread file. Cost is a wasted edit + a re-read + a retry. One
  upfront read is cheaper than the recovery window.
- **One search, not five.** Identical `(name, tool_input)` issued ≥2× in a turn is
  pure waste. Plan the search, fire it once, read the result.
- **Worktree agents must `pnpm install` first**, or edits silently no-op via
  fallback to the main checkout. Worktree branches off `main`, not the current
  branch — pin the integration SHA in the agent prompt.
- **Quality gates are hooks, not vibes.** `.husky/pre-commit` runs
  lint-staged + `pnpm typecheck` + `pnpm knip`; a PostToolUse hook lints/knips
  after each edit. Don't hand-run what the hook already runs — but DO run
  `pnpm check` before declaring done, because CI is the real backstop.
- **Hooks only cover TS/JS.** A `.py` script, `.md`, or config file gets **no**
  deterministic gate — verify those yourself; the hook won't catch you.
- **`pnpm`, never `npm`/`yarn`.**

## Code shape (enforced by `pnpm check:structure` + ESLint)

- Max nesting depth 2 — guard clauses, no `else` after `return`, extract nested loops.
- Named logic file per dir (`enrich/enrich.ts`, not `index.ts`); barrels re-export only.
- Tests live inside the module dir (`enrich/enrich.test.ts`). Keep tests basic:
  happy path + obvious errors, not exotic edges.
- Comments explain non-obvious WHY, not WHAT — prefer a named function over a
  step-narrating comment.

## Before launching fix subagents / PRs

Hand over a clean-session **verification prompt** with query-based PASS thresholds,
so the change is checked from a fresh context, not the one that wrote it.

## Definition of done

`pnpm check` green → branch pushed → PR opened → stopped for human review.
Not "the edit applied."
