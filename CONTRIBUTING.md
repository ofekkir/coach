# Contributing to coach

Thanks for helping improve coach. This guide covers getting set up and the contribution process. It
does **not** restate the engineering rules — those have a single home and apply to humans and agents
alike:

- **Code style, module file conventions, quality gates, and the branch/PR workflow** →
  [`CLAUDE.md`](CLAUDE.md). It is the canonical operating manual for the repo; read it before your
  first change.
- **Architecture** (package layout, data flow) → [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **What coach is and where it's going** → [`README.md`](README.md).

## Prerequisites

- **[pnpm](https://pnpm.io)** — the only supported package manager. Do **not** use npm or yarn.
- **Node ≥ 20.11** (see `engines` in `package.json`).

```bash
pnpm install
```

## Making a change

1. **Branch off `main`** — never commit to `main` directly. Every change goes through a branch + PR.
2. Make your change, following the code style and module conventions in [`CLAUDE.md`](CLAUDE.md).
3. Keep tests **basic**: cover the normal path and obvious error cases, not exotic edge cases.
4. Run the full gate locally before pushing — a PR is mergeable only when it passes:

   ```bash
   pnpm check    # typecheck + lint + format:check + test + knip + structure (same as CI)
   ```

5. Open a pull request. CI runs on PR open, on every push to the branch, and on pushes to `main`.

The gates are enforced deterministically (pre-commit hooks + CI), not on trust — don't weaken them to
make code pass; fix the code instead. See [`CLAUDE.md`](CLAUDE.md) for how the gates are wired.

## Reporting bugs and proposing features

Use the GitHub issue templates. For broader questions or ideas, open a
[GitHub Discussion](https://github.com/ofekkir/coach/discussions). To report a security issue, follow
[`SECURITY.md`](SECURITY.md) instead of opening a public issue.
