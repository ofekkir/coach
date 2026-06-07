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

function extractErrorInfo(err: unknown): { message: string; stderr?: string; stdout?: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (typeof err !== 'object' || err === null) return { message };
  const rec = err as Record<string, unknown>;
  const info: { message: string; stderr?: string; stdout?: string } = { message };
  if (typeof rec.stderr === 'string' && rec.stderr.length > 0) info.stderr = rec.stderr;
  if (typeof rec.stdout === 'string' && rec.stdout.length > 0) info.stdout = rec.stdout;
  return info;
}

async function callClaude(prompt: string): Promise<Map<string, string>> {
  const { stdout, stderr } = await execFileAsync(
    'claude',
    ['-p', prompt, '--model', 'claude-haiku-4-5', '--output-format', 'json'],
    { timeout: 120_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
  );
  if (stderr.length > 0) process.stderr.write(stderr);
  const wrapper = JSON.parse(stdout) as { result: string };
  const items = JSON.parse(wrapper.result) as { id: string; what: string }[];
  return new Map(items.map((item) => [item.id, item.what]));
}

async function callClaudeWithRetry(
  prompt: string,
  batchIds: string[],
): Promise<Map<string, string>> {
  let lastError: unknown;
  try {
    return await callClaude(prompt);
  } catch (err) {
    lastError = err;
  }
  try {
    return await callClaude(prompt);
  } catch (err) {
    lastError = err;
  }
  const { message, stderr, stdout } = extractErrorInfo(lastError);
  process.stderr.write(`[claude-labeler] batch failed (ids: ${batchIds.join(', ')})\n`);
  process.stderr.write(`  error: ${message}\n`);
  if (stderr != null) process.stderr.write(`  subprocess stderr:\n${stderr.slice(0, 1000)}\n`);
  if (stdout != null) process.stderr.write(`  subprocess stdout:\n${stdout.slice(0, 500)}\n`);
  return new Map();
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
