# The Agent Mental Model

> What an agent execution _is_, expressed precisely enough that Coach can attach findings
> to the right unit — and the basis for what the visualization renders.
>
> This is a **conceptual** document. It defines the vocabulary and the model; it does not
> prescribe types or file layout (see `docs/implementation-prompt.md` and `ARCHITECTURE.md`
> for that). Keep it honest as the model evolves.

## Why this model exists

Coach reflects findings back to the agent (and, for now, the engineer). A finding is only
useful if it points at the **right unit of behavior**: "your plan was wrong" is a different
claim about a different thing than "this tool call failed" or "this whole sub-goal took four
retries." To make those claims precisely, we need a model of agent execution with named
levels — and we need to be clear about which levels are _given to us_ versus which ones
_we infer_.

## The single most important distinction: mechanical vs. semantic

Everything in the model is one of two kinds:

- **Mechanical** — derivable deterministically from the trace (OTEL spans / native logs).
  No interpretation. The same input always yields the same structure. This is _free_.
- **Semantic** — requires interpreting _what the agent was doing_. Not present in the trace
  as a boundary or label; it must be inferred (by heuristic now, by an LLM classifier later).
  **This interpreted layer is the value Coach adds.** The trace gives you the skeleton;
  Coach supplies the meaning.

The model is a mechanical skeleton with a semantic layer laid over it.

## The hierarchy

```
                         MECHANICAL (from spans)            SEMANTIC (inferred — Coach's value)
  agent                  user.id                            —
   └─ session            session.id                         —
       └─ interaction    claude_code.interaction span       has a GOAL
            │            (one per user prompt;
            │             interaction.sequence)
            │
            ├─ threads ───── mechanical execution lanes ──── (cross-cut by segments)
            │   • main thread  = the spine of the interaction
            │   • sub-threads  = sub-agent loops spawned by a Task action
            │
            └─ steps ──────── inference | action ─────────── grouped into SEGMENTS (sub-goals)
                 • action     = one tool execution           one extrinsic, observable verb
                 • inference  = one LLM forward pass          0..n intrinsic, interpreted verbs
                                  (an ordered list of moves)
```

### agent → session → interaction (mechanical)

- **agent** — identified by `user.id`.
- **session** — identified by `session.id`.
- **interaction** — one user prompt to the final output of the agent. This is the
  `claude_code.interaction` span that Claude Code's OTEL exporter already emits, one per user
  prompt, carrying `interaction.sequence`, `user_prompt`, `interaction.duration_ms`.
  "Turn" is a synonym we avoid; **interaction** is the harness-native word and the one we use.

  > **Parity note (native logs):** native `.jsonl` sessions must be split into one interaction
  > per user prompt to match OTEL. The historical bug was emitting a single interaction for the
  > whole session — fixing that is step one of implementation.

### threads (mechanical lanes)

A thread is an **execution lane**, not a unit of meaning:

- The **main thread** is the spine of the interaction — created by the interaction itself (the
  user prompt kicks it off), **not** by any action.
- A **sub-thread** is a sub-agent loop, and it _is the execution of a `Task` action_: the agent
  emits a `Task` tool call (an action), the harness runs the sub-agent to completion inside that
  action's execution window, and returns its result as the tool result. So a sub-thread **is**
  created by an action; the main thread is the one exception.

Thread identity is mechanical _at the inference level_ — the harness tags each inference with
the loop (`source`) that emitted it. Action membership in a thread is weaker: it is often
**reconstructed** by timing rather than read directly. So "threads are mechanical" is true for
inferences and approximate for actions.

### steps: inference | action

A **step** is the atomic unit of the flow within a thread. Two kinds:

- **action** — one tool execution. Its verb is **extrinsic and observable**: it is simply what
  the tool did (`Edit`, `Read`, `Bash git push`). One action = one verb.
  _Caveat:_ a single tool call can smuggle several (`Bash("pnpm test && git push")`, fat MCP
  tools), so the verb is only as fine-grained as the call.

- **inference** — one LLM forward pass. Its output is an **ordered list of content blocks**,
  and each block is a **move** carrying its own verb:

  | content block | move / verb examples                                                              |
  | ------------- | --------------------------------------------------------------------------------- |
  | `thinking`    | `reason`, `plan`                                                                  |
  | `text`        | `summarize`, `answer`, `translate`, `classify`, `extract`, `generate`, `critique` |
  | `tool_use`    | `act` — and this move is exactly what spawns an **action** step                   |

  These verbs are an **open vocabulary**, not a closed enum — the table lists _examples_ of the
  kinds of cognitive work an inference does, not the complete set. Implementations should start
  from a small curated seed, allow new labels, and **surface** unrecognized ones rather than
  forcing everything into a fixed list. `act` is the one special, structural member: it always
  maps to an action step.

  So an inference can carry **multiple verbs** (e.g. `{plan, summarize}` then acts), or
  **zero** communicative verbs — the **pure tool-pick**, an inference whose output is _only_
  `tool_use` blocks. Zero verbs does not mean "did nothing": its work is entirely directives,
  and we account for that work on the **action** steps it spawns. (This is why there is no
  separate `decide` verb — it would double-count the act.)

### segments (semantic — sub-goals)

An interaction has a **goal**, which decomposes into **one or more sub-goals**. Each sub-goal
is a **segment**: a grouping of the interaction's steps that serves one end.

Example — a single prompt "fix these two bugs and remind me of X" is **one** interaction but
**three** segments:

```
interaction "fix 2 bugs + remind me"            (1 user prompt, 1 span)
 ├─ segment "fix bug A"     → read, edit, verify
 ├─ segment "fix bug B"     → read, edit, verify, verify
 └─ segment "set reminder"  → 1 inference
```

Two properties matter:

- **Segments cross-cut threads — they do not nest under them.** A segment can recruit a
  thread: while pursuing one sub-goal the agent may fire a `Task` action that spawns a
  sub-thread devoted to that sub-goal. So containment runs **segment ⊇ sub-thread**. The main
  thread is the **shared spine, partitioned among segments**; sub-threads belong to the segment
  that spawned them. Threads (mechanical) and segments (semantic) are two _orthogonal_
  partitions of the same step set.
- **Segments are not in the trace.** There is no span boundary that says "now starting bug B."
  Segment boundaries are inferred. This is the heart of Coach's interpretation work.

## Interaction shapes

A useful mechanical-ish classification of an interaction's control flow:

- **completion / query** — one inference, ends `end_turn`, no actions. (User asks, model
  answers.) Exactly one segment.
- **agentic / ask** — an inference ↔ action loop: `inference →(tool_use) action* → inference …
→ inference(end_turn)`. May contain multiple segments and sub-threads.

## What the visualization shows

The visualization renders the **mechanical skeleton** and overlays the **semantic layer**:

- A **causal graph** of the structure: `agent ▸ session ▸ interaction ▸ thread ▸ step`, with
  expand/collapse. Sub-threads appear under the action that spawned them.
- **Segmentation** as an overlay on an interaction's steps — adjacent steps grouped/colored by
  the sub-goal they serve, so the eye reads "this run of steps was one goal."
- **Verbs** annotated on steps: the extrinsic verb on each action; the move(s) on each
  inference.
- An interaction **shape** badge — a small label on each interaction marking its control-flow
  form: **query** (one inference, answered directly, no tools) vs. **agentic** (an
  inference↔action loop). It tells you at a glance whether the interaction was a plain answer or
  a tool-using loop, and helps spot mismatches (a query that should have used tools, or an
  agentic loop that was overkill).

The point of rendering it this way: every level is a place a finding can attach, and the user
can _see_ the unit a finding refers to.

## What this unlocks (the ground for discoveries)

Because every level is named, findings can be keyed precisely:

| Level          | Example finding                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------- |
| move/inference | the **plan** move was flawed; a tool was hallucinated; a summary dropped a key fact            |
| action         | redundant re-reads; a failed command silently ignored; a verify loop repeated 3×               |
| segment        | this sub-goal took four retries; cost-per-sub-goal; a sub-goal abandoned mid-way               |
| interaction    | latency; total token cost; thread fan-out; query that should have been agentic (or vice-versa) |

This is what "reflecting findings back to the agent" stands on: a shared, precise vocabulary
for _which_ part of its own behavior the agent is being told about.
