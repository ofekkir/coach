# Semantics configuration

Declarative inputs that turn mechanical execution-graph nodes into ontology-grounded
semantic labels. **These are data, not code** — everything `derive.ts` used to hardcode
(tool→verb maps, the `.claude/` path special-casing, the suggestion-mode and session-title
markers, the thinking/tool_use structural roles) now lives here, so a weak model only ever
picks from a known, small vocabulary.

Status: **wired in.** `graph/semantic/tool-intent.ts` + `derive.ts` interpret this config;
`graph/semantic/config.ts` defines the typed shape and `assembleSemanticsConfig`. The pure
pipeline never reads disk — `scripts/load-semantics-config.ts` (the Node CLI seam) parses these
JSON files and injects the assembled `SemanticsConfig` into `runPipelineAsync`. The interpreter
is **agent-agnostic**: swapping in another agent/project triple needs no pipeline change.

## The three artifacts (by scope)

| File                      | Scope       | Owns                                                                                   | How it's produced                                    |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `ontology/coding.json`    | **domain**  | The closed vocabulary: `actions` + `objects` + `messageActs`. Source of truth.         | Hand-authored, slow-changing.                        |
| `agents/claude-code.json` | **agent**   | tool name + input → (action, target); well-known paths; harness markers + roles.       | Hand-authored per harness.                           |
| `projects/coach.json`     | **project** | `tech` (stack) + `architecture` (path → object) + `commands` (command→action grammar). | **Generate once with a strong model**, cache/commit. |

A domain ontology is shared across agents in that domain; what is genuinely per-agent is the
_tool vocabulary_, not the action set. Agents reference the ontology by id (`"ontology": "coding"`).

## Resolution order (how a node gets labeled)

```
node (tool | llm_request)
  │
  ├─ llm_request → markers     (agent.markers)            ── session-title? suggestion-mode?  ─┐ fully
  │                                                                                            │ determined,
  │                                                                                            │ no model
  ├─ tool → tool semantics     (agent.tools[name])        ── action + target field            │
  │            │                                                                               │
  │            ├─ target.kind == path → project.architecture pathRules → object + label        │
  │            ├─ escape-hatch (Bash) → project.commands grammar (first match wins, .* escape)  │
  │            └─ unknown tool → agent.tools._unknownTool (act / unknown, low-confidence)        │
  │                                                                                            │
  ├─ llm_request structural prefix (agent.structuralRoles)── thinking→plan, tool_use→invoke    │
  │                                                                                            │
  └─ genuine terminal message  → agent.modelResidual      ── WEAK MODEL classifies the act ────┘
                                                              (verbs = ontology.messageActs)
final `what` = deterministic prefix ++ model phrases
```

The model is the **last resort**, invoked only for a real terminal assistant message
(`response_text` present and the turn does not end in a `tool_use`). Everything above it is a
lookup.

## The binding contract (referential integrity)

`ontology/coding.json` is the **single source of truth for the vocabulary**. Every `action` and
`object` value in the agent and project files MUST be an id defined there. This is the rule that
keeps three independently-edited files from drifting into unaggregatable labels.
`assembleSemanticsConfig` (in `graph/semantic/config.ts`) **enforces this at load time** — it
throws if any agent/project file references an action or object id absent from the ontology, so a
typo or stray id fails the `--enrich` run instead of silently mislabeling.

Quick manual check (every referenced id resolves against the ontology):

```bash
node -e '
  const ont = require("./ontology/coding.json");
  const A = new Set(ont.actions.map(a => a.id));
  const O = new Set(ont.objects.map(o => o.id));
  const refs = JSON.stringify([require("./agents/claude-code.json"), require("./projects/coach.json")]);
  const bad = [...refs.matchAll(/"(action|object)":\s*"([^"]+)"/g)]
    .filter(m => !(m[1] === "action" ? A : O).has(m[2]));
  console.log(bad.length ? "UNKNOWN IDS: " + bad.map(m => m[1]+":"+m[2]) : "ok");
'
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
