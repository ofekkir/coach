# @coach/semantics

The typed, validated vocabulary contract consumed by the pipeline's enrichment stage (stage 6).
Turns mechanical execution-graph nodes into ontology-grounded semantic labels. The JSON artifacts
under `src/data` are **data, not code** — everything the interpreter used to hardcode (tool→verb
maps, the `.claude/` path special-casing, the suggestion-mode and session-title markers, the
thinking/tool_use structural roles) lives here, so labels are drawn from a known, small vocabulary.
Enrichment is **fully deterministic**; there is no model in the loop (see "model labeler" below).

**Pure package, no disk seam.** `src/config.ts` defines the Zod schemas, the inferred types, and
`assembleSemanticsConfig` (validate + referential-integrity check). `src/defaults.ts` **imports** the
two bundled JSON artifacts and assembles `defaultSemanticsConfig` — the JSON is inlined by the
bundler, never read from the file system, so the same assembled config serves both the Node CLI and
the browser app. The pipeline's `graph/semantic` interpreter consumes the assembled `SemanticsConfig`
and is **agent-agnostic**: swapping in another domain/agent pair needs no pipeline change.
`enrichExecutionGraph(graph, config)` is the entry point; the CLI passes `defaultSemanticsConfig`.

## The two artifacts (by scope)

| File                           | Scope      | Owns                                                                                                                                                                                                                                                       | How it's produced             |
| ------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `data/ontology/coding.json`    | **domain** | Closed vocabulary (`actions` + `objects` + `messageActs`), universal `commands` grammar (git, shell builtins, common tool runners), and transferable `conventions` (file-role + structural-qualifier rules that type a path generically). Source of truth. | Hand-authored, slow-changing. |
| `data/agents/claude-code.json` | **agent**  | tool name + input → (action, target); well-known paths; harness markers + roles.                                                                                                                                                                           | Hand-authored per harness.    |

There is **no project layer**. Per-project file-organization mapping coupled labels to one repo's
directory structure and didn't transfer; it's been replaced by domain-level `conventions`, so any
coding project is grounded with zero per-project authoring. A domain ontology is shared across agents
in that domain; what is genuinely per-agent is the _tool vocabulary_, not the action set. Agents
reference the ontology by id (`"ontology": "coding"`).

### Conventions (how a path gets typed, generically)

`conventions.paths` types a file by **role** from its name/path (regex, first match wins) — e.g.
`*.test.ts`→unit-test, `tsconfig*`→build-config, `*.ts`→source-code. `conventions.structure` extracts
a **structural qualifier** from generic layout patterns — `packages|apps|libs/<name>/` → `package=<name>`.
A path renders as `{object} ({qualifier})`, e.g. `edit packages/pipeline/src/x.ts` → `edit source code
(package=pipeline)`; with no qualifier it's just the object type; an unmatched path keeps its basename
(the full path is preserved on the canonical node for detail display).

## Resolution order (how a node gets labeled)

```
node (tool | llm_request)
  │
  ├─ llm_request → markers     (agent.markers)            ── session-title? suggestion-mode?  ─┐ fully
  │                                                                                            │ determined,
  │                                                                                            │ no model
  ├─ tool → tool semantics     (agent.tools[name])        ── action + target field            │
  │            │                                                                               │
  │            ├─ target.kind == path → ontology.conventions (paths + structure) → object       │
  │            ├─ escape-hatch (Bash) → ontology.commands grammar (.* escape)                    │
  │            └─ unknown tool → agent.tools._unknownTool (act / unknown, low-confidence)        │
  │                                                                                            │
  ├─ llm_request structural prefix (agent.structuralRoles)── thinking→plan, tool_use→invoke    │
  │                                                                                            │
  └─ genuine terminal message  → ontology `respond` action ── deterministic, generic ──────────┘
final `what` = structural prefix ++ (respond, for a terminal message)
```

A genuine terminal assistant message (`response_text` present and the turn does not end in a
`tool_use`) is labeled with the generic `respond` act. Everything is a deterministic lookup.

### Model labeler (removed for now)

A weak-model labeler used to classify the _act_ of a terminal message into a finer verb from
`ontology.messageActs` (answer / confirm / suggest / summarize …). It was removed until the tool
proves the finer granularity is needed. The `messageActs` vocabulary is **kept in the ontology**,
reserved so reintroducing the labeler is a re-wiring, not a re-authoring. Until then, every terminal
message collapses to `respond` — and a high `respond` rate is itself the signal that the labeler may
be worth bringing back.

## The binding contract (referential integrity)

`data/ontology/coding.json` is the **single source of truth for the vocabulary**. Every `action`
and `object` value in the agent file (and in the ontology's own `conventions`) MUST be an id defined
in the ontology. This is the rule that keeps independently-edited config from drifting into
unaggregatable labels. `assembleSemanticsConfig` (in `src/config.ts`) **enforces this** — it throws
if any reference names an action or object id absent from the ontology. Because
`defaultSemanticsConfig` is assembled at module import, a typo or stray id fails fast (at import, and
in `config.test.ts`) instead of silently mislabeling.

```bash
pnpm --filter @coach/semantics test   # asserts the bundled pair assembles + refs resolve
```

## Escape hatches (open-world safety)

Both axes have an explicit unknown (`action: act`, `object: unknown`). Unmatched tools, commands,
and paths resolve to these rather than being forced into a wrong bucket — so coverage gaps surface
as low-confidence "unknown" labels instead of confident mislabels. Treat a rising rate of `unknown`
as the signal that the ontology or a grounding file is missing a concept.

## Deliberately out of scope

**Composition / inference nodes.** Rolling leaf labels up into higher intent ("implemented feature
X" from 6 edits + 1 test run + 1 lint) is a separate problem with no artifact here yet. The leaf
representation deliberately preserves the `(action, object, target)` tuple plus the causal-graph
edges so composition stays reconstructable later.
