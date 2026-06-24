# coach

**The agent grades itself.** Coach turns an agent's own execution traces into a queryable model of
what it did — then hands that model back to the agent through MCP, so Claude Code can load its own
sessions and surface its own expensive, hallucinated, or wasteful steps. Existing agent tracing is
built for the _engineer_ to observe the agent; coach's north star is to close that loop back to the
**agent itself**, with the engineer monitoring the loop. It works on **OpenTelemetry (OTEL) traces**
by design, which keeps coach **harness-agnostic**.

A **second pillar** sits beside that optimization work: because coach holds _complete sessions_ and
_many of them_, it aims to infer user **intent in hindsight** and aggregate it across sessions into a
per-agent **user model** — what users want, how they phrase it, what they leave unsaid, what needs
clarification — a personalization signal population-level RLHF cannot produce. See
`docs/agent-model.md` for the conceptual model.

The shipped surface (what works today) is narrower than the vision above: a pure staged
**pipeline**, a React Flow **visualization**, and a read-only **MCP query server**. See `README.md`
for the two-tier shipped-vs-roadmap split.

**`ARCHITECTURE.md` is a living document** — update it in the same change whenever package
layout, module boundaries, or data flow change. Consult it before architectural tasks.

## Tech stack

- **Language:** TypeScript (ESM, strict)
- **Package manager:** pnpm (do not use npm/yarn)
- **Lint/format:** ESLint (flat config, `strict-type-checked`) + Prettier
- **Dead code:** Knip (unused files, exports, dependencies)
- **Tests:** Vitest
- **CI:** GitHub Actions

## Commands

```bash
pnpm install          # install dependencies
pnpm check            # typecheck + lint + format:check + test + knip + structure (what CI runs)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint, warnings = errors (--max-warnings=0)
pnpm lint:fix         # eslint --fix
pnpm format           # prettier --write .
pnpm format:check     # prettier --check .
pnpm test             # vitest run
pnpm test:watch       # vitest (watch)
pnpm knip             # check for unused files, exports, and dependencies
pnpm check:structure  # enforce module file naming and test placement conventions
pnpm build            # emit dist/ via tsup
```

## Quality gates are enforced by hooks, not by trust

Linting/formatting/type/test rules are enforced **deterministically**, in three committed layers —
not as polite requests in this file:

1. **`.husky/pre-commit`** — runs `lint-staged` (ESLint `--fix` + Prettier on staged files),
   `pnpm typecheck`, and `pnpm knip` on **every commit, by every contributor**. This is the primary gate.
2. **`.claude/hooks/lint.sh`** and **`pnpm knip`** (wired via `.claude/settings.json` `PostToolUse`) —
   formats, lints, and checks for dead code immediately after Claude edits a file.
3. **`.github/workflows/ci.yml`** — re-runs the full `pnpm check` (including knip) as the backstop
   that cannot be bypassed locally.

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

- **Max nesting depth: 2.** Use guard clauses (early return/continue/break) instead of nested ifs. Invert conditions and return early so the happy path stays at the lowest indent level.
- **Extract nested loops.** When two loops nest because they're doing conceptually different things, pull the inner loop into a named function.
- **Prefer array methods over explicit loops** (`.filter()`, `.map()`, `.flatMap()`) where it reads clearly — they eliminate nesting and name the intent.
- **No else after return.** If a branch returns/throws, the else block is unnecessary indirection — write the else body at the outer level.

## Module file conventions

Enforced by `pnpm check:structure` (also runs in pre-commit):

- **Named logic files:** when a module lives in its own directory, the core logic file is named after the directory — `enrich/enrich.ts`, not `enrich/index.ts`. This makes the file's purpose unambiguous without opening it.
- **Barrel files are re-export only:** `index.ts` files may only contain `export … from` statements — no logic. Enforced by ESLint (`no-restricted-syntax` on `**/index.ts`). Avoid creating internal barrels; only the package root `index.ts` should aggregate exports.
- **Tests live inside their module directory:** `enrich/enrich.test.ts`, not `etl/enrich.test.ts`. A test file must not be a sibling of the directory it tests.

## Layout

See `ARCHITECTURE.md` for the package layout and data flow — it is kept in sync with the code, so it
is the single source of truth rather than a duplicated tree here.
