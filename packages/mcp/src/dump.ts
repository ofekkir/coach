// Shared stage-output dump. Writes the six `01..06` stage JSON files plus the
// self-contained `.db` artifact for one pipeline run into a directory, returning
// the written paths. The `pnpm e2e` CLI and `load_dataset` (on a directory load)
// both call this so the file names + shapes stay identical — the e2e verification
// and the `open_viz` server depend on them. The `.db` write lives here (not in
// @coach/pipeline) because it is node/duckdb-bound via `writePersistedDb`.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PipelineResult } from '@coach/pipeline';

import { writePersistedDb } from './duckdb.ts';

const JSON_INDENT = 2;

function dumpJson(outDir: string, stepLabel: string, data: unknown): string {
  const filePath = join(outDir, `${stepLabel}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, JSON_INDENT) + '\n');
  return filePath;
}

// Input-bearing members are projected to names/types so the dumps stay readable;
// the graph members are dumped in full — they are the point of inspection. The
// `06-enriched-graph` `{ executionGraph }` wrapper matches what the app's loader
// (`extractExecutionGraph`) expects.
function dumpStageJson(result: PipelineResult, outDir: string): string[] {
  return [
    dumpJson(
      outDir,
      '01-classified',
      result.classified.map((c) => ({ name: c.file.name, path: c.file.path, type: c.type })),
    ),
    dumpJson(
      outDir,
      '02-sessions',
      result.sessions.map((s) => ({
        sessionId: s.sessionId,
        kind: s.kind,
        inputs: s.inputs.map((i) => i.file.name),
      })),
    ),
    dumpJson(outDir, '03-canonical-by-session', result.canonicalBySession),
    dumpJson(outDir, '04-agent-graph', result.agentGraph),
    dumpJson(outDir, '05-execution-graph', result.executionGraph),
    dumpJson(outDir, '06-enriched-graph', { executionGraph: result.enrichedGraph }),
  ];
}

const DB_FILE_NAME = 'graph.db';

/** Writes the six stage JSON files + the tables-only `.db` for one pipeline
 *  run into `outDir` (created if missing) and returns every written path. */
export async function dumpPipelineOutputs(
  result: PipelineResult,
  outDir: string,
): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const jsonPaths = dumpStageJson(result, outDir);
  const dbPath = join(outDir, DB_FILE_NAME);
  // writePersistedDb appends to an existing file (CREATE TABLE would clash on a
  // re-dump), so clear any stale .db first — the dump is a fresh artifact.
  rmSync(dbPath, { force: true });
  await writePersistedDb(result.enrichedGraph, dbPath);
  return [...jsonPaths, dbPath];
}
