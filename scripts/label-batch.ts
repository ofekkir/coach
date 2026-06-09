import { log } from '@coach/logger';
import type { LabelBatchFn, LabelRequest } from '@coach/pipeline';

// Transport-agnostic labeling: prompt construction, batching, retry, and parsing
// live here so each model adapter only implements "prompt in → raw text out".

// Small batches keep unrelated nodes from bleeding context into one another (a
// translate-session node smearing "translate" onto an adjacent planning node).
const BATCH_SIZE = 8;
const MAX_ATTEMPTS = 2;

// ── Prompt ────────────────────────────────────────────────────────────────────

export function buildPrompt(batch: readonly LabelRequest[]): string {
  const nodes = batch.map((r) =>
    r.kind === 'tool'
      ? { id: r.id, kind: r.kind, tool: r.name ?? '', input: r.tool_input ?? '' }
      : {
          id: r.id,
          kind: r.kind,
          user_message: r.last_user_text ?? '',
          response_text: r.response_text ?? '',
          called_tool: r.response_tool ?? '',
        },
  );

  return `You label nodes in an AI agent's execution trace. For each node, output an ARRAY of short
action phrases (each ≤6 words, lowercase, no filler) describing what the agent actually DID at
that node. Most nodes are a single action — use multiple entries only when the node genuinely
performs several distinct steps in sequence.

tool node — describe the INTENT behind the call; read \`input\`, never just echo the tool name.
  {"tool":"Read","input":"{\\"file_path\\":\\"~/.claude/settings.json\\"}"}  ->  ["read claude settings file"]
  {"tool":"WebFetch","input":"{\\"url\\":\\"ynet.co.il\\",\\"prompt\\":\\"summarize headlines\\"}"}  ->  ["fetch ynet.co.il", "summarize headlines"]
  BAD: ["read"], ["run webfetch"]   <- echoing the tool name carries no intent

llm_request node — \`response_text\` is your primary signal (what the model produced); \`user_message\`
gives context; \`called_tool\` is the tool the inference decided to invoke next, if any.
  {"user_message":"translate it to french now"}  ->  ["recognize request to translate to french"]
  {"response_text":"I'll read the settings then edit it","called_tool":"Read"}  ->  ["plan settings edit", "read settings file"]
  BAD: a model name like "claude-sonnet-4-6"; a phrase copied verbatim from these instructions.

Nodes:
${JSON.stringify(nodes)}

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

export function makeLabelBatch(callModel: CallModel): LabelBatchFn {
  return async (requests) => {
    const results = new Map<string, readonly string[]>();

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
