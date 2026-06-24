# Contributing to coach

Thanks for helping improve coach. This guide distills the workflow; it does not repeat the design —
for architecture see [ARCHITECTURE.md](ARCHITECTURE.md), and for the why see [README.md](README.md).

## Prerequisites

- **[pnpm](https://pnpm.io)** — the only supported package manager. Do **not** use npm or yarn.
- **Node ≥ 20.11** (see `engines` in `package.json`).

```bash
pnpm install
```

## Workflow

- **Branch off `main`.** Never commit to `main` directly — every change goes through a branch + PR.
- Open a pull request. CI runs on PR open, on every push to the branch, and on pushes to `main`.
- A PR is mergeable only when the full check passes:

  ```bash
  pnpm check    # typecheck + lint + format:check + test + knip + structure (same as CI)
  ```

- Keep tests **basic**: cover the normal path and obvious error cases, not exotic edge cases.

## Quality gates

Gates are enforced deterministically, not on trust — don't weaken them to make code pass, fix the
code instead.

- **`.husky/pre-commit`** runs `lint-staged` (ESLint `--fix` + Prettier on staged files),
  `pnpm typecheck`, and `pnpm knip` on every commit.
- **ESLint treats warnings as errors** (`--max-warnings=0`); TypeScript runs with `strict` plus
  extra safety flags.
- **[knip](https://knip.dev)** fails the build on unused files, exports, and dependencies.
- **`pnpm check:structure`** enforces the module file conventions below.

## Code style

- Prefer named functions and descriptive names over comments that narrate steps. Comments are for
  non-obvious **why**, not for labelling **what**.
- **Max nesting depth 2** — use guard clauses (early return/continue/break), invert conditions, keep
  the happy path at the lowest indent. No `else` after `return`.
- Prefer array methods (`.filter()`, `.map()`, `.flatMap()`) over explicit loops where they read
  clearly. Extract nested loops into named functions.

## Module file conventions

Enforced by `pnpm check:structure` (and pre-commit):

- **Named logic files:** a module in its own directory names its core file after the directory —
  `enrich/enrich.ts`, not `enrich/index.ts`.
- **Barrel files are re-export only:** `index.ts` may only contain `export … from` statements.
  Avoid internal barrels; only the package root `index.ts` aggregates exports.
- **Tests live inside their module directory:** `enrich/enrich.test.ts`, not a sibling of the
  directory it tests.

## Reporting bugs and proposing features

Use the GitHub issue templates. For broader questions or ideas, open a
[GitHub Discussion](https://github.com/headroomlabs-ai/coach/discussions). To report a security
issue, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
