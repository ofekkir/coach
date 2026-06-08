import { spawn } from 'node:child_process';
import type { LabelBatchFn } from '@coach/pipeline';
import { makeLabelBatch } from './label-batch.ts';

const BYTES_PER_KIB = 1024;
const MAX_BUFFER_MIB = 4;

const MAX_BUFFER = MAX_BUFFER_MIB * BYTES_PER_KIB * BYTES_PER_KIB;
const TIMEOUT_MS = 120_000;

// ── Subprocess call ───────────────────────────────────────────────────────────

const callClaude = async (prompt: string): Promise<string> =>
  new Promise((resolve, reject) => {
    // stdio: ['ignore', ...] closes stdin so Claude does not wait for terminal input.
    // --output-format text gives the model's response directly; label-batch parses it.
    const proc = spawn(
      'claude',
      ['-p', prompt, '--model', 'claude-haiku-4-5', '--output-format', 'text'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`claude timed out after ${String(TIMEOUT_MS)}ms: ${stderr}`));
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
        reject(new Error(`claude exited with code ${String(code)}: ${stderr}`));
        return;
      }
      resolve(stdout);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

// ── Public export ─────────────────────────────────────────────────────────────

export const claudeLabelBatch: LabelBatchFn = makeLabelBatch(callClaude);
