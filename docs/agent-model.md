# The Agent Mental Model

> What an agent execution _is_, expressed precisely enough that Coach can attach findings
> to the right unit — and the basis for what the visualization renders.
>
> This is a **conceptual** document. It defines the vocabulary and the model; it does not
> prescribe types or file layout — see [`ARCHITECTURE.md`](../ARCHITECTURE.md) for that.
> Keep it honest as the model evolves.

## Why this model exists

Coach aims to reflect findings back to the agent (and, for now, surfaces them to the engineer). A
finding is only useful if it points at the **right unit of behavior**: "your plan was wrong" is a different
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
  agent                  user.id                            the USER MODEL (rolled up across
   │                                                          all sessions — see below)
   └─ session            session.id                         intent themes; recurring (mis)reads
       └─ interaction    claude_code.interaction span       carries 1..n INTENTS (a GOAL is the
            │            (one per user prompt;                 agent's operative read of one)
            │             interaction.sequence)
            │
            ├─ user prompt ─ the interaction's INPUT ──────── states the GOAL (which the
            │                (full prompt; head of the         segments serve / diverge from)
            │                 spine) — not a step
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

### user prompt (mechanical input, the goal source)

The interaction's **first node is the user prompt** — the full text the human sent, carried on
the `interaction` span's `user_prompt`. It is **mechanical** (read straight from the trace) but
distinct from everything below it: it is neither an inference nor an action — it is not a
**step** at all. It is the interaction's _input_ and the head of the main thread's spine; the
first inference is a _response_ to it.

It earns its own node because it is the **goal source**. The interaction's GOAL is not given
to us as a label — the prompt is the closest thing we have to a stated goal, and segments
(the inferred sub-goals) are read _against_ it. That makes the prompt the anchor for a whole
class of findings: an **under-specified prompt** the agent filled in by assumption (e.g. the
user said _"fetch X"_ and the agent decided to _summarize_ it), or a trajectory that **drifted**
from what was asked. Without a prompt node, "what the user actually asked" has nowhere to attach.

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

The visualization renders two graphs over the same execution: the **execution graph** (the
mechanical skeleton) and the **semantic graph** (the inferred overlay, where a semantic node wraps
the execution node it interprets).

- The **execution graph** — a causal graph of the mechanical structure:
  `agent ▸ session ▸ interaction ▸ user prompt ▸ thread ▸ step`, with expand/collapse. The user
  prompt is the interaction's first node (its input); threads descend from it. Sub-threads appear
  under the action that spawned them. This is the deterministic skeleton, no interpretation.
- The **semantic graph** — Coach's inferred layer laid over the execution graph. Each semantic node
  **wraps** the execution node(s) it interprets, so the two graphs share one source of truth:
  - **Segmentation** — an interaction's steps grouped by the sub-goal (segment) they serve, so the
    eye reads "this run of steps was one goal."
  - **Verbs** annotated on steps: the extrinsic verb on each action; the move(s) on each inference.
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

The **action**- and **interaction**-level rows of that table are not hypothetical — [`case-study.md`](case-study.md)
keys real findings to exactly those levels (failed tool calls ranked by recovery cost) over the
maintainer's own session history, using only the shipped query surface.

## Hindsight intent & the user model

Everything above describes a _single_ interaction. Two facts change the picture once Coach holds
**complete sessions** — and **many of them**. This section is more forward-looking than the rest of
the document; it records where the model is heading, not a built stage.

### Intent is recoverable in hindsight

A live agent infers intent _forward_, with no feedback, and must guess when a prompt is
under-specified. Coach reads the trace _backward_: a later interaction that corrects ("no, I meant
staging"), re-asks, or confirms ("that worked") is a **label** on whether the earlier intent was
understood. The completed session is the supervised signal the live agent never had.

So Coach can do **retrospective intent inference** — derive what the user _actually_ wanted, scored
against what the agent's segments actually served, and surface the gap. **Intent is the user side;
the goal/segment is the agent side** — the operative goal is what the agent _did_, the intent is
what the user _meant_, and the distance between them is the core error class:

- intent with no segment serving it → **ignored ask**
- segment serving no intent → **drift / unrequested work**
- right intent, wrong shape → a query answered agentically (overkill), or an agentic need answered
  as a query (under-delivery)

This is also why an interaction **carries 1..n intents** rather than a single GOAL: "fix these two
bugs and remind me of X" is a flat set of co-equal intents, not one goal with sub-goals.
Goal-decomposition is the special case where n = 1.

### Aggregation across sessions → the user model

This is what fills the empty SEMANTIC cells at the **session** and **agent** levels in the
hierarchy above. The semantic layer is not only a per-interaction overlay — it **rolls up**:

| Level         | Semantic rollup                                                         |
| ------------- | ----------------------------------------------------------------------- |
| _interaction_ | intent(s) + fulfillment — diagnosis: was this ask understood?           |
| _session_     | recurring intent themes; how intents were systematically mis-/well-read |
| _agent_       | the **user model** — a distilled, per-agent (or per-user) prior         |

The user model is what they want, how they phrase it, what they leave unsaid that can be safely
inferred, and what genuinely needs a clarifying question — for example:

- _intent-translation_ — says "fix X" but means "fix X **and** add a test"
- _shape priors_ — this user's "quick question" is never a query, always agentic
- _style_ — wants the diff, not the explanation
- _standing constraints_ — "clean up" means lint+format, never refactor

The user model is the artifact **RLHF structurally cannot produce**. RLHF bakes a
_population-averaged_ policy into _shared weights_, frozen at training time and identical for every
user; the only per-user channel a deployed model has is its **context**. Coach computes a per-user
_correction_ to that population prior and feeds it into exactly that channel — it would not compete
with fine-tuning, it would supply the one input fine-tuning leaves open. The loop is meant to close
at the **agent** node: the semantic layer is conceived as a function from a session forest to an
agent-level user model, which would be both an output (to the engineer/agent) and an input (to
future runs). None of this is built yet.

### The consequence: aggregation forces canonicalization

"This user keeps doing X" is only computable if X has a stable identity. Free-text intent per
interaction supports _diagnosis_ but cannot be _rolled up_. Aggregation therefore demands a
canonical form (a typed schema, or embeddings + clustering), and the bounded context channel forces
the same compression — you cannot feed "all sessions" forward, you must distill to a compact prior.
That distillation **is** the hard problem, and it is literally "learn a user model." The
open-vocabulary tension noted for verbs reappears here, sharper.

### Two honest caveats

- **Credit assignment is confounded.** A bad session may be the agent's misread _or_ a genuinely
  vague prompt — and those imply opposite fixes (correct the agent vs. ask the user to be clearer).
  The user model learns noise if the two are not separated.
- **This is a second pillar, not a replacement.** Coach's first pillar stands: harness optimization
  — accuracy, latency, cost, hallucination/operational-error detection, engineer-facing. The user
  model is a _different output with a different consumer_ (the agent, for personalization). Both
  rest on the same intent-inference machinery; keep them distinct in scope and success metrics.

### Prior art

This model synthesizes five literatures, each of which owns one piece. The intersection —
_recover intent retrospectively from an execution trace, then aggregate it into a per-agent prior
fed back into the loop_ — is what is novel here.

- **The gap** — Norman's [Gulf of Execution & Gulf of Evaluation](https://en.wikipedia.org/wiki/Gulf_of_execution):
  intention vs. what the system affords/shows.
- **Meaning beyond the literal** — Grice's [Cooperative Principle & implicature](https://plato.stanford.edu/entries/implicature/):
  inferring intent the prompt left unsaid.
- **Understanding as a process** — Clark & Brennan, ["Grounding in Communication"](https://web.stanford.edu/~clark/1990s/Clark,%20H.H.%20_%20Brennan,%20S.E.%20_Grounding%20in%20communication_%201991.pdf):
  common ground and its breakdown; corrections/re-asks are grounding signals.
- **Inferring intent from actions** — plan / goal / intention recognition and the
  [BDI](https://en.wikipedia.org/wiki/Belief%E2%80%93desire%E2%80%93intention_software_model)
  (desire = goal, intention = committed plan) lineage.
- **Following intent, population-level** — Ouyang et al.,
  [InstructGPT](https://arxiv.org/abs/2203.02155): alignment = following explicit + implicit intent,
  but baked into shared weights — the reason per-user adaptation must live in context, not weights.
- **The user model** — personalization beyond RLHF
  ([survey](https://arxiv.org/html/2411.00027v3); [learning to remember conversations](https://arxiv.org/pdf/2411.13405)).
