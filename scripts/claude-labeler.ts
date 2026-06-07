import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LabelBatchFn, LabelRequest } from '@coach/pipeline';

const execFileAsync = promisify(execFile);

const BATCH_SIZE = 25;

function buildPrompt(batch: readonly LabelRequest[]): string {
  const nodes = batch.map((r) => {
    if (r.kind === 'tool')
      return { id: r.id, kind: r.kind, name: r.name ?? '', input: r.tool_input ?? '' };
    return { id: r.id, kind: r.kind, prompt: r.prompt ?? '', response: r.response ?? '' };
  });

  return `Label each agent execution node with a one-line "what" description (max 8 words, no filler).
- tool: what action did the agent take? (e.g. "run tests", "edit the CI workflow", "read package.json")
- llm_request: what cognitive task? (e.g. "plan next steps", "answer user question", "summarize tool output")

Nodes:
${JSON.stringify(nodes)}

Respond with ONLY a JSON array, no other text:
[{"id":"<id>","what":"<one-liner>"},...]`;
}

async function callClaude(prompt: string): Promise<Map<string, string>> {
  const { stdout } = await execFileAsync(
    'claude',
    ['-p', prompt, '--model', 'claude-haiku-4-5', '--output-format', 'json'],
    { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const wrapper = JSON.parse(stdout) as { result: string };
  const items = JSON.parse(wrapper.result) as { id: string; what: string }[];
  return new Map(items.map((item) => [item.id, item.what]));
}

async function callClaudeWithRetry(
  prompt: string,
  batchIds: string[],
): Promise<Map<string, string>> {
  try {
    return await callClaude(prompt);
  } catch {
    try {
      return await callClaude(prompt);
    } catch {
      // Both attempts failed — return empty map so semantic.ts uses mechanical fallbacks
      process.stderr.write(`[claude-labeler] batch failed for ids: ${batchIds.join(', ')}\n`);
      return new Map();
    }
  }
}

export const claudeLabelBatch: LabelBatchFn = async (requests) => {
  const results = new Map<string, string>();

  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    const batchIds = batch.map((r) => r.id);
    const labels = await callClaudeWithRetry(buildPrompt(batch), batchIds);
    for (const [id, what] of labels) results.set(id, what);
  }

  return results;
};
