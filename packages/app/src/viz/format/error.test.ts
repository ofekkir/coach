import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runPipeline } from '@coach/pipeline';
import type { ResolvedNode, UploadedFile } from '@coach/pipeline';
import { describe, expect, it } from 'vitest';

import { buildNodeCard } from './format.ts';

// The real chain, end to end: the failed-edit fixture → runPipeline view-model →
// buildNodeCard. Proves the error fields survive the pipeline AND that the card
// builder surfaces them — the gap this change closes.
const FIXTURE = join(
  import.meta.dirname,
  '../../../../pipeline/fixtures/native-claude/failed-edit/session.jsonl',
);

function toolCardsByName(): Map<string, ReturnType<typeof buildNodeCard>> {
  const files: UploadedFile[] = [{ name: 'session.jsonl', content: readFileSync(FIXTURE, 'utf8') }];
  const { enrichedGraph } = runPipeline(files);
  const byName = new Map<string, ReturnType<typeof buildNodeCard>>();
  for (const [id, node] of Object.entries(enrichedGraph.nodes)) {
    if (node.type !== 'tool' || node.name == null) continue;
    const resolved: ResolvedNode = {
      node,
      ...(enrichedGraph.semantics[id] != null ? { semantics: enrichedGraph.semantics[id] } : {}),
    };
    byName.set(node.name, buildNodeCard(resolved));
  }
  return byName;
}

describe('error fields survive the pipeline into the node card', () => {
  it('marks the failed Edit card with its error_kind and message', () => {
    const edit = toolCardsByName().get('Edit');
    expect(edit?.error?.kind).toBe('invalid_args');
    expect(edit?.error?.message).toBeTruthy();
  });

  it('leaves the succeeding Read card without an error', () => {
    expect(toolCardsByName().get('Read')?.error).toBeUndefined();
  });
});
