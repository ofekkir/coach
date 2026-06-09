import type { LabelBatchFn } from '@coach/pipeline';
import { makeLabelBatch } from './label-batch.ts';

// Local inference via Ollama's HTTP API. Override host/model with env vars.
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const TIMEOUT_MS = 120_000;

// A JSON-schema `format` constrains the model to emit a valid array of labels,
// so small local models stay reliable without depending on instruction-following.
const RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      what: { type: 'array', items: { type: 'string' } },
    },
    required: ['id', 'what'],
  },
} as const;

interface OllamaChatResponse {
  message?: { content?: string };
}

const callOllama = async (prompt: string): Promise<string> => {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: RESPONSE_SCHEMA,
      options: { temperature: 0 },
    }),
  });

  if (!res.ok) throw new Error(`ollama ${String(res.status)}: ${await res.text()}`);

  const data = (await res.json()) as OllamaChatResponse;
  return data.message?.content ?? '';
};

export const ollamaLabelBatch: LabelBatchFn = makeLabelBatch(callOllama);
