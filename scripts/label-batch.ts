import { log } from '@coach/logger';
import type { LabelBatchFn, LabelRequest } from '@coach/pipeline';

// Transport-agnostic labeling: prompt construction, batching, retry, and parsing
// live here so each model adapter only implements "prompt in → raw text out".

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 2;

// ── Prompt ────────────────────────────────────────────────────────────────────

export function buildPrompt(batch: readonly LabelRequest[]): string {
  const nodes = batch.map((r) => {
    if (r.kind === 'tool')
      return { id: r.id, kind: r.kind, name: r.name ?? '', input: r.tool_input ?? '' };
    return {
      id: r.id,
      kind: r.kind,
      request_delta: r.request_delta ?? '',
      response_delta: r.response_delta ?? '',
    };
  });

  return `Label each agent execution node with a short "what" description (max 12 words, no filler).
- tool: what high-level action did the agent take? Prefer intent over mechanics.
  (e.g. "run tests", "edit the CI workflow", "read project manifest", "delete dead code")
- llm_request: what cognitive task(s)? Use "and" when one inference covers multiple tasks.
  (e.g. "plan next steps", "answer user question", "assess context and decide next action",
   "summarize tool output and draft response")

Nodes:
${JSON.stringify(nodes)}

Respond with ONLY a JSON array, no other text:
[{"id":"<id>","what":"<description>"},...]`;
}

// ── Parsing ─────────────────────────────────────────────────────────────────--

function parseLabels(text: string): Map<string, string> {
  // Extract the first JSON array from the response (handles any preamble text).
  const match = /\[[\s\S]*\]/.exec(text);
  const jsonText = match != null ? match[0] : text.trim();
  const items = JSON.parse(jsonText) as { id: string; what: string }[];
  return new Map(items.map((item) => [item.id, item.what]));
}

// ── Retry + fallback ──────────────────────────────────────────────────────────

// A model adapter: send one prompt, resolve the raw model text, throw on failure.
export type CallModel = (prompt: string) => Promise<string>;

async function callWithRetry(
  callModel: CallModel,
  prompt: string,
  batchIds: string[],
): Promise<Map<string, string>> {
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

export function makeLabelBatch(callModel: CallModel): LabelBatchFn {
  return async (requests) => {
    const results = new Map<string, string>();

    for (const r of requests) log.debug(r, 'label request');

    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      const batch = requests.slice(i, i + BATCH_SIZE);
      const batchIds = batch.map((r) => r.id);
      const labels = await callWithRetry(callModel, buildPrompt(batch), batchIds);
      for (const [id, what] of labels) results.set(id, what);
    }

    return results;
  };
}
