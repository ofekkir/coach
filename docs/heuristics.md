# Coach Heuristics

> A catalogue of signals Coach can surface. Each heuristic is keyed to the level of the
> agent model it attaches to (see `agent-model.md`). Categories are not mutually exclusive —
> a single observation can fall under several.

---

## Hallucination / Grounding

- Agent produces a **query** interaction (no tool actions) when a Read/Search action was clearly
  necessary to ground the answer — KB miss.
- A tool call names a file or function that does not appear in any prior Read result in the same
  interaction — fabricated reference.
- A `plan` move names a sub-goal that never appears in any subsequent segment — planned but
  silently abandoned.

## Loop / Thrash Detection

- The same `(action verb, target)` pair appears ≥3 times within one segment without a success
  signal between them — edit-loop.
- Segments share identical or near-identical goal strings across repeated interactions — recurring
  stall the agent cannot self-resolve.
- Inference ↔ action step count per segment grows monotonically across retries of the same
  sub-goal — escalating thrash, not convergence.

## Dead Work / Redundancy

- Read action on a path already read in the same segment with no intervening Edit — redundant
  re-read.
- Verify action fires on a file that was never edited in this interaction — stale check.
- Sub-thread spawned by a Task action whose result is never referenced in any subsequent inference
  — orphaned sub-agent.

## Model Cost Efficiency

- Inference whose only moves are `classify` or `extract` on structured data is routed to the
  expensive model — cheap-task misroute.
- A query interaction (single inference, no tools) exceeds N tokens — over-generation for a
  simple answer.
- A sub-thread doing read-only work (all Read/Search verbs) runs on the primary model when a
  cheaper reader would suffice.

## Novel / Unknown Verbs

- An inference produces a content block whose verb does not match any known seed label — unknown
  cognitive move, surface for review rather than forcing into a fixed category.
- An action tool name appears for the first time across all sessions for this agent — novel
  capability use, may warrant supervisor awareness.

## Structural Shape Mismatches

- Interaction is shaped **query** (no actions) but the prompt contains imperative phrases — agent
  answered instead of acting.
- Interaction spawns N > K sub-threads immediately — fan-out spike, possible over-parallelization
  or missing context.
- A segment reaches `end_turn` mid-way through a multi-part prompt's implied sub-goals — early
  abandonment.

## Timing / Latency

- A single action step accounts for more than X% of total interaction duration — latency cliff,
  worth isolating.
- Inference step durations grow across a segment without a corresponding growth in context size —
  possible backoff or retry inside the LLM call.

## Error Handling

- Action returns an error; the immediately following inference contains no `reason` or `plan` move
  — silent error swallow.
- The same error string appears in 3+ consecutive action results without the segment goal
  changing — stuck loop disguised as progress.

---

## Aggregated Layer — Cross-Session Rollup

> The heuristics above operate on a single interaction or session. Roll them up across many
> sessions and a second class of findings emerges: **fleet-level signals** about the agent's
> habitual behavior rather than one-off mistakes.

### Hot Actions / Optimization Targets

- Rank action verbs by total call count and cumulative duration across sessions. Actions in the
  top decile by volume are the highest-leverage targets for caching, batching, or offloading.
- Actions that are both frequent **and** consistently followed by a Verify step are candidates for
  a built-in post-condition — the agent is manually doing what could be automatic.

### Recurring Stalls

- Segments with the same goal string that fail (no success signal) across N sessions identify
  a systematic capability gap — not a one-off error but a repeating cliff the agent hits.
- Interactions whose step count is a clear outlier for a given goal type signal that certain
  prompts reliably cause over-planning or over-retrying.

### Verb Distribution Drift

- Track the frequency distribution of inference verbs per week. A new verb appearing and
  stabilizing in the top-10 is a signal the agent's usage pattern has shifted — worth reviewing
  whether the harness is configured for it.
- A verb that was once common and drops to near-zero may indicate a broken tool or a prompt
  change that silently removed a capability.

### Cost Attribution

- Roll up token cost per segment-goal-type to get a cost-per-task table. Outlier task types
  drive disproportionate spend and are the first place to look for prompt or model-tier
  improvements.
- Compare cost-per-task across agent versions after a prompt or model change — a regression here
  is as important as a correctness regression.

### Model Tier Audit

- Aggregate the cheap-task misroute signal across sessions to get a misroute rate per verb. A
  high rate for `classify` or `extract` verbs is a concrete, quantified case for adding a
  smaller-model routing rule.

### Capability Coverage

- Map which tools (action verbs) are used in each session. Tools that exist but never appear
  across many sessions may be dead configuration — or an opportunity the agent is missing.
- Novel-verb events aggregated across sessions show the rate at which the agent encounters
  genuinely new situations — a leading indicator of when the seed vocabulary needs updating.
