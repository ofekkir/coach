import { spawn } from 'node:child_process';
import type { LabelBatchFn, LabelRequest } from '@coach/pipeline';

const BATCH_SIZE = 25;
const MAX_BUFFER = 4 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

// ── Custom error carries subprocess output for diagnostics ────────────────────

class ClaudeSubprocessError extends Error {
  readonly stderr: string;
  readonly stdout: string;

  constructor(message: string, stderr: string, stdout: string) {
    super(message);
    this.name = 'ClaudeSubprocessError';
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

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

// ── Subprocess call ───────────────────────────────────────────────────────────

async function callClaude(prompt: string): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    // stdio: ['ignore', ...] closes stdin so Claude does not wait for terminal input.
    // --output-format text gives the model's response directly; we parse it as JSON
    // ourselves (simpler than hunting the result event in the stream-json array).
    const proc = spawn(
      'claude',
      ['-p', prompt, '--model', 'claude-haiku-4-5', '--output-format', 'text'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill();
      reject(new ClaudeSubprocessError(`timed out after ${String(TIMEOUT_MS)}ms`, stderr, stdout));
    }, TIMEOUT_MS);

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_BUFFER) proc.kill();
    });

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new ClaudeSubprocessError(`exited with code ${String(code)}`, stderr, stdout));
        return;
      }
      try {
        // Extract the first JSON array from the response (handles any preamble text).
        const match = /\[[\s\S]*\]/.exec(stdout);
        const jsonText = match != null ? match[0] : stdout.trim();
        const items = JSON.parse(jsonText) as { id: string; what: string }[];
        resolve(new Map(items.map((item) => [item.id, item.what])));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new ClaudeSubprocessError(`parse failed: ${msg}`, stderr, stdout));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Retry + fallback ──────────────────────────────────────────────────────────

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
  const e = lastError instanceof ClaudeSubprocessError ? lastError : null;
  process.stderr.write(`[claude-labeler] batch failed (ids: ${batchIds.join(', ')})\n`);
  process.stderr.write(
    `  error: ${lastError instanceof Error ? lastError.message : String(lastError)}\n`,
  );
  if (e?.stdout) process.stderr.write(`  stdout: ${e.stdout.slice(0, 500)}\n`);
  return new Map();
}

// ── Public export ─────────────────────────────────────────────────────────────

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
