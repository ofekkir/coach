import type { Move } from '../types.ts';

// ── Response body shape ───────────────────────────────────────────────────────

interface ResponseBlock {
  readonly type: string;
  readonly text?: string;
}

interface ResponseBody {
  readonly content?: readonly ResponseBlock[];
  readonly stop_reason?: string;
}

function parseResponseBody(raw: string | undefined): ResponseBody | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as ResponseBody;
  } catch {
    return null;
  }
}

// ── Verb derivation ───────────────────────────────────────────────────────────

// Structured side-calls (title-gen, compaction) emit a JSON-object text block.
// Seam: replace with a per-source query_source check, or an LLM classifier,
// once we have enough examples to be more precise.
function isStructuredSideCall(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function textVerb(text: string, stopReason: string | undefined): string {
  if (isStructuredSideCall(text)) return 'generate';
  if (stopReason === 'end_turn') return 'answer';
  return 'summarize';
}

function blockToMove(block: ResponseBlock, stopReason: string | undefined): Move | null {
  if (block.type === 'thinking') return { verb: 'reason', blockType: 'thinking' };
  if (block.type === 'text')
    return { verb: textVerb(block.text ?? '', stopReason), blockType: 'text' };
  if (block.type === 'tool_use') return { verb: 'act', blockType: 'tool_use' };
  return null;
}

// Returns the ordered list of moves for one inference step.
// Pure tool-pick inferences (only tool_use blocks) return only act moves —
// the communicative layer is empty, which is correct per the model.
export function inferenceMovesFromRawResponse(rawResponse: string | undefined): readonly Move[] {
  const body = parseResponseBody(rawResponse);
  if (body?.content == null) return [];
  return body.content.flatMap((block) => {
    const move = blockToMove(block, body.stop_reason);
    return move != null ? [move] : [];
  });
}

// Returns the single extrinsic verb for an action step.
// For Bash, the first command token is appended so "Bash git" distinguishes
// git operations from "Bash pnpm" or "Bash ls".
export function actionVerbFromNode(
  name: string | undefined,
  toolInput: string | undefined,
): string {
  if (name == null) return 'unknown';
  if (name === 'Bash' && toolInput != null) {
    const firstToken = toolInput.trim().split(/\s+/)[0];
    return firstToken != null && firstToken.length > 0 ? `Bash ${firstToken}` : 'Bash';
  }
  return name;
}
