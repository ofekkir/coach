// ════════════════════════════════════════════════════════════════════════════
// Interaction INTENT_CATEGORY — a CLOSED, deterministic dimension that buckets a
// whole interaction by what the user asked for, derived from the prompt text.
// It is the interaction-level analogue of the tool-level `action` (see action.ts):
// one value from a small fixed set, a pure function of the prompt, reproducible.
//
// It is derived by the SAME mechanism as the rest of stage-6 semantics — a pure,
// config/rule-driven labeler invoked in the enrichment pass (semantic.ts), no LLM.
// Every interaction MUST resolve to a non-NULL category; `other` is the explicit
// catch-all when no signal matches (an empty prompt → `other`).
// ════════════════════════════════════════════════════════════════════════════

/** The closed intent vocabulary. Order is documentation only. */
export const INTENT_CATEGORIES = [
  'debug', // diagnose/fix a failure, error, or broken behavior
  'feature', // add new capability / build something new
  'refactor', // restructure/clean up existing code without behavior change
  'explain', // understand/describe existing code or a concept (no change asked)
  'test', // write, run, or fix tests
  'ops', // build/deploy/CI/release/dependency/version-control/config work
  'research', // gather external information (web, docs, comparisons)
  'other', // explicit catch-all — never NULL
] as const;

/** An interaction intent — one of the closed {@link INTENT_CATEGORIES} values. */
export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

// Ordered keyword rules: first category whose pattern matches the prompt wins.
// Order encodes priority — more specific intents (debug, test) are checked before
// broader ones (feature, ops) so "fix the failing test" classifies as `test`-aware
// debug only where intended. Patterns are word-boundary anchored, case-insensitive.
interface IntentRule {
  readonly category: IntentCategory;
  readonly pattern: RegExp;
}

const INTENT_RULES: readonly IntentRule[] = [
  {
    category: 'debug',
    pattern:
      /\b(debug|fix|bug|broken|error|fail(?:s|ing|ed)?|crash(?:es|ing|ed)?|not working|doesn'?t work|stack ?trace|exception|regress(?:ion)?|reproduce)\b/i,
  },
  {
    category: 'test',
    pattern:
      /\b(test|tests|testing|unit ?test|integration ?test|coverage|spec|specs|vitest|jest|pytest|assert(?:ion)?s?)\b/i,
  },
  {
    category: 'refactor',
    pattern:
      /\b(refactor|restructure|clean ?up|rename|extract|simplif(?:y|ied)|reorganiz|dedup(?:licate)?|tidy|deduplicate|move (?:the|this)? ?(?:function|method|file|module))\b/i,
  },
  {
    category: 'explain',
    pattern:
      /\b(explain|what (?:is|are|does|do)|how (?:does|do|is)|why (?:is|does|do)|understand|describe|walk me through|tell me about|summari[sz]e|document)\b/i,
  },
  {
    category: 'research',
    pattern:
      /\b(research|look up|search (?:the )?(?:web|online|for)|find out|compare|investigate|latest|best practice|alternatives?|which (?:library|tool|framework))\b/i,
  },
  {
    category: 'ops',
    pattern:
      /\b(deploy|deployment|build|ci\/?cd|pipeline|release|publish|install|upgrade|dependenc(?:y|ies)|version|commit|push|pull ?request|pr\b|merge|branch|rebase|config(?:ure|uration)?|env(?:ironment)? ?var|docker|kubernetes|k8s)\b/i,
  },
  {
    category: 'feature',
    pattern:
      /\b(add|implement|create|build|introduce|support|new |feature|enable|wire up|set up|scaffold|write (?:a|the|some)? ?(?:function|component|endpoint|module|class|script))\b/i,
  },
];

/**
 * Maps an interaction's user prompt to its closed {@link IntentCategory}. Pure and
 * deterministic: the first matching rule (in priority order) wins; a prompt that
 * matches no rule — or an empty/whitespace prompt — yields `other`. Never NULL.
 */
export function classifyIntent(prompt: string | undefined): IntentCategory {
  const text = (prompt ?? '').trim();
  if (text === '') return 'other';
  const rule = INTENT_RULES.find((r) => r.pattern.test(text));
  return rule?.category ?? 'other';
}
