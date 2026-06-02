# coach

Coach improves agent harnesses — accuracy, latency, cost, hallucination and operational-error
detection — by analyzing **OpenTelemetry (OTEL) traces**. OTEL is used deliberately so coach stays
**harness-agnostic**.

The thesis: existing agent tracing is built for the _engineer_ to observe and improve the agent.
Coach instead aims to reflect findings back to the **agent itself**, with the engineer monitoring
that loop. How the loop is ultimately "closed" back to the agent is undecided — so **stage one
targets the engineer** until we learn which problems are actually solvable.

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

```
packages/
  pipeline/           # @coach/pipeline — pure ETL + view model (no node:* imports)
    src/
      etl/            # enrich + transform pipeline (+ co-located *.test.ts)
      graph/          # view-model (CausalGraphView, VizData)
      orchestrate.ts  # buildVizResults — file-system-free orchestration
      index.ts        # public exports
    fixtures/         # test fixtures (native .jsonl + OTEL sets)
  app/                # @coach/app — React SPA (upload UI + graph renderer)
    src/
      upload/         # UploadPage.tsx — landing page + file intake
      viz/            # App.tsx, layout.ts, TraceNode.tsx
      data-source.ts  # processUploads seam (swap for HTTP call to add a backend)
      main.tsx
scripts/              # Node CLI — reads from disk, delegates to @coach/pipeline
.claude/
  settings.json       # committed Claude Code config (PostToolUse lint + knip hooks)
  hooks/lint.sh       # per-file lint hook script
.husky/pre-commit     # git pre-commit gate
.github/workflows/    # CI
ARCHITECTURE.md       # living architecture doc — keep in sync with changes
```
