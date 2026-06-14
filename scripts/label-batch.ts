import { log } from '@coach/logger';
import type { LabelBatchFn, LabelRequest } from '@coach/pipeline';
import type { MessageAct } from '@coach/semantics';

// Transport-agnostic labeling: prompt construction, batching, retry, and parsing
// live here so each model adapter only implements "prompt in → raw text out".

// Small batches keep unrelated nodes from bleeding context into one another (a
// translate-session node smearing "translate" onto an adjacent planning node).
const BATCH_SIZE = 8;
const MAX_ATTEMPTS = 2;

// ── Prompt ────────────────────────────────────────────────────────────────────

function verbList(acts: readonly MessageAct[]): string {
  return acts.map((a) => (a.hint != null ? `- ${a.verb}: ${a.hint}` : `- ${a.verb}`)).join('\n');
}

/** The model-residual prompt. The allowed verbs are the ontology's `messageActs`
 *  (injected, not hardcoded) — add a verb to the ontology, not to this string. */
export function buildPrompt(batch: readonly LabelRequest[], acts: readonly MessageAct[]): string {
  const items = batch.map((r) => ({ id: r.id, text: r.response_text }));

  return `You are given the final messages an AI agent sent to its user. For each item, output a
JSON array naming the ACT(s) the message performed — never quote, summarize, or repeat the
content itself, and never output a model name. Each phrase is "<verb> <generic object>",
≤5 words, lowercase. Emit one phrase per distinct act, in order.

Use only these verbs:
${verbList(acts)}
Pair each with a generic object (e.g. "session", "edit", "next steps", "question", "text").

  "Done. The Grafana server is configured. Next: replace the token and test it."
     ->  ["confirm edit", "suggest next steps"]
  "We fetched ynet and summarized its headlines. No next action is pending."
     ->  ["summarize session", "suggest next action"]
  "A city inspector caught on tape, threatening a teen in a beach-side scrape."
     ->  ["translate text"]
  BAD: ["claude-sonnet-4-6"]; quoting the message; copying these example phrases verbatim.

Items:
${JSON.stringify(items)}

Respond with ONLY a JSON array, no other text:
[{"id":"<id>","what":["<phrase>", ...]},...]`;
}

// ── Parsing ─────────────────────────────────────────────────────────────────--

function toPhrases(what: unknown): string[] {
  if (Array.isArray(what)) return what.filter((p): p is string => typeof p === 'string');
  if (typeof what === 'string') return [what];
  return [];
}

function parseLabels(text: string): Map<string, readonly string[]> {
  // Extract the first JSON array from the response (handles any preamble text).
  const match = /\[[\s\S]*\]/.exec(text);
  const jsonText = match != null ? match[0] : text.trim();
  const items = JSON.parse(jsonText) as { id: string; what: unknown }[];
  return new Map(items.map((item) => [item.id, toPhrases(item.what)]));
}

// ── Retry + fallback ──────────────────────────────────────────────────────────

// A model adapter: send one prompt, resolve the raw model text, throw on failure.
export type CallModel = (prompt: string) => Promise<string>;

async function callWithRetry(
  callModel: CallModel,
  prompt: string,
  batchIds: string[],
): Promise<Map<string, readonly string[]>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return parseLabels(await callModel(prompt));
    } catch (err) {
      lastError = err;
    }
  }
  log.error(
    { ids: batchIds, error: lastError instanceof Error ? lastError.message : String(lastError) },
    '[labeler] batch failed',
  );
  return new Map();
}

// ── Public factory ──────────────────────────────────────────────────────────--

export function makeLabelBatch(callModel: CallModel, acts: readonly MessageAct[]): LabelBatchFn {
  return async (requests) => {
    const results = new Map<string, readonly string[]>();

    for (const r of requests) log.debug(r, 'label request');

    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      const batch = requests.slice(i, i + BATCH_SIZE);
      const batchIds = batch.map((r) => r.id);
      const labels = await callWithRetry(callModel, buildPrompt(batch, acts), batchIds);
      for (const [id, what] of labels) results.set(id, what);
    }

    return results;
  };
}
