# Open-source release checklist

Tracks the work to take this repo public. Items are grouped by workstream. Check them off as
they land. **Hard blockers** must be done before the repo is made public.

The north-star framing for the launch: **agent self-critique via MCP** — Claude Code loads its own
sessions through the coach MCP and surfaces its own expensive / hallucinated / wasteful steps. The
demo dataset and the demo video both anchor on that moment.

---

## WS1 — Scrub PII _(done in PR `chore/scrub-pii-and-origin`)_

- [x] Remove stray committed `.claire/` worktree file; ignore `.claire/`.
- [x] Neutralize machine-specific path literals in non-fixture tests
      (`materialize.test.ts`, `resolve-dataset.test.ts`, `resolve-dataset.ts`).
- [x] Decouple fixture-coupled assertions from PII/origin literals
      (`native.test.ts`, `materialize.test.ts`) so test source is clean even while the fixtures
      are not yet regenerated.
- [x] Add a **CI-only** PII/origin guard driven by the private `PII_DENYLIST` repo
      secret — no patterns committed to the open tree. Lists only matching file
      paths, never the matched text, so a hit can't echo the secret into public logs.

## WS2 — Synthetic fixtures _(HARD BLOCKER)_

The fixtures under `packages/pipeline/fixtures/` are **raw captured Claude Code sessions** and still
contain the author's email, home path, the personal project name, third-party plugin/marketplace
names, and origin-specific fetched content (a non-English regional news site + non-English-language
turns). These are embedded
inside full request/response transcripts and **cannot be safely scrubbed by find-and-replace** — they
must be regenerated.

- [ ] Record fresh Claude Code sessions on a **neutral, public, English task** that doubles as the
      wow-moment demo (a generic coding/research task).
- [ ] Plant a **teachable flaw** in at least one session (a redundant retry, a weak-model misread,
      or an over-expensive step) so the self-critique demo lands on something real.
- [ ] Export both OTEL (`otel/*`) and native (`native-claude/*`) variants to keep parity with the
      current three fixtures.
- [ ] Re-couple the decoupled test assertions to the new fixtures' content if desired.
- [ ] **Remove the `packages/pipeline/fixtures/` path-exclusion in the CI PII-guard step**
      (`.github/workflows/ci.yml`) and confirm the guard passes over the fixtures too.

## WS3 — Wow-moment demo (agent self-critique via MCP)

- [ ] Write the demo script: register coach MCP → `/mcp` shows connected → "load my last sessions
      and find the most expensive / hallucinated / wasteful steps" → agent runs `query` /
      `causal_path` → surfaces a concrete self-critique → `open_viz` to show it on the graph.
- [ ] Explore 2–3 framings of the core value before committing to one.
- [ ] Record a screen capture (GIF / short video) into `docs/media/` (or `assets/`).
- [ ] Reference it from the top of the README.

## WS4 — Vision vs shipped (two-tier README)

- [ ] Lead the README with a punchy vision hook, then an explicit **"What works today"** section
      (pipeline → graph → MCP query surface — all shipped) above a labeled **"Where this is going"**
      section (agent-feedback-loop closure, cross-session user model / second pillar — roadmap).
- [ ] Audit `docs/agent-model.md` and `ARCHITECTURE.md` for present-tense claims about unshipped
      capability; reword to future tense / mark as design intent.
- [ ] Verify the README MCP tool table matches the actually-registered tools.

## WS5 — Repo metadata & open-source hygiene

- [ ] Decide whether the monorepo root publishes; set `package.json` `repository` (org URL),
      `author`, `license` fields accordingly (root stays `private` if it does not publish).
- [ ] Move the repo from the personal account to the org; update every `/ABSOLUTE/PATH/TO/coach`
      and clone URL in docs.
- [ ] Confirm `LICENSE` (Apache-2.0) NOTICE/copyright line names the org if preferred over a
      personal name.
- [ ] Add community files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR
      templates. **Intentionally skip a Discord/community-server CTA** — link issues/discussions
      instead.

## WS6 — Final gate _(HARD BLOCKER)_

- [ ] Decide on git **history**: scrub or squash to a single initial commit so historical PII
      (email, home paths, captured transcripts in old commits) does not ship.
- [ ] `pnpm check` green; CI PII guard green with the fixtures exclusion removed.
- [ ] Fresh-clone smoke test: clone → `pnpm install` → `pnpm check` → `pnpm e2e <fixture>` → MCP
      demo path works end to end.
