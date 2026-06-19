// Dataset intake. Reads a directory of trace/native files off disk into the same
// flat UploadedFile[] the browser upload produces, runs the pipeline, and keeps
// the stage-6 enriched graph + the stage-7 analysis. This is the one place in the
// MCP that touches the filesystem; everything downstream is graph-only.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import {
  runPipeline,
  type ExecutionGraph,
  type GraphAnalysis,
  type UploadedFile,
} from '@coach/pipeline';

export interface Dataset {
  /** Stage-6 enriched execution graph — the substance the store queries. */
  readonly graph: ExecutionGraph;
  /** Stage-7 curated analysis — exposed as-is via the `get_analysis` tool. */
  readonly analysis: GraphAnalysis;
}

function toUploadedFile(fullPath: string, rootDir: string): UploadedFile {
  return {
    name: basename(fullPath),
    content: readFileSync(fullPath, 'utf8'),
    path: relative(rootDir, fullPath),
  };
}

function gatherFiles(dir: string, rootDir: string): UploadedFile[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return gatherFiles(fullPath, rootDir);
    return [toUploadedFile(fullPath, rootDir)];
  });
}

/** Loads every file under `dir` and runs the full pipeline over them. */
export function loadDataset(dir: string): Dataset {
  const { enrichedGraph, analysis } = runPipeline(gatherFiles(dir, dir));
  return { graph: enrichedGraph, analysis };
}
