# coach

Coach improves agent harnesses — accuracy, latency, cost, hallucination and operational-error
detection — by analyzing **OpenTelemetry (OTEL) traces**. OTEL is used deliberately so coach stays
**harness-agnostic**.

The thesis: existing agent tracing is built for the _engineer_ to observe and improve the agent.
Coach instead aims to reflect findings back to the **agent itself**, with the engineer monitoring
that loop. How the loop is ultimately "closed" back to the agent is undecided — so **stage one
targets the engineer** until we learn which problems are actually solvable.

## Tech stack

- **Language:** TypeScript (ESM, strict)
- **Package manager:** pnpm (do not use npm/yarn)
- **Lint/format:** ESLint (flat config, `strict-type-checked`) + Prettier
- **Tests:** Vitest
- **CI:** GitHub Actions

## Commands

```bash
pnpm install          # install dependencies
pnpm check            # typecheck + lint + format:check + test (what CI runs)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint, warnings = errors (--max-warnings=0)
pnpm lint:fix         # eslint --fix
pnpm format           # prettier --write .
pnpm format:check     # prettier --check .
pnpm test             # vitest run
pnpm test:watch       # vitest (watch)
pnpm build            # emit dist/ via tsconfig.build.json
```

## Quality gates are enforced by hooks, not by trust

Linting/formatting/type/test rules are enforced **deterministically**, in three committed layers —
not as polite requests in this file:

1. **`.husky/pre-commit`** — runs `lint-staged` (ESLint `--fix` + Prettier on staged files) and a
   full `pnpm typecheck` on **every commit, by every contributor**. This is the primary gate.
2. **`.claude/hooks/lint.sh`** (wired via `.claude/settings.json` `PostToolUse`) — formats and lints
   each file immediately after Claude edits it, surfacing errors back into the agent loop.
3. **`.github/workflows/ci.yml`** — re-runs the full `pnpm check` as the backstop that cannot be
   bypassed locally.

Strictness: TypeScript runs with `strict` plus extra safety flags; ESLint treats **warnings as
errors** (`--max-warnings=0`). Don't weaken these to make code pass — fix the code.

## Workflow rules

- **Never commit directly to `main`.** Every change goes through a branch + PR.
- CI runs on PR open, every push to the PR branch, and every push to `main`.
- A PR is mergeable only when `pnpm check` passes (enable branch protection on `main` so this is
  required — see README).
- Keep tests **basic** for now: cover the normal path and obvious error cases, not exotic edge cases.

## Code style

Prefer named functions and descriptive variable names over inline comments that narrate steps.
A function named `groupLogsBySpan()` is better than a `// 2. Group logs by span_id` comment
before an anonymous block. Comments are for non-obvious WHY, not for labelling WHAT.

## Layout

```
src/
  index.ts            # public exports
  trace/span.ts       # OTEL span model coach reasons about
  analysis/           # trace-analysis logic (+ co-located *.test.ts)
.claude/
  settings.json       # committed Claude Code config (PostToolUse lint hook)
  hooks/lint.sh       # the hook script
.husky/pre-commit     # git pre-commit gate
.github/workflows/    # CI
```
