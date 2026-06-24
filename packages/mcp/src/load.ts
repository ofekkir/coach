// Dataset intake. Reads a directory of trace/native files off disk into the same
// flat UploadedFile[] the browser upload produces, runs the pipeline, and keeps
// the stage-6 enriched graph. This is the one place in the MCP that touches the
// filesystem; everything downstream is graph-only.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import {
  runPipeline,
  type ExecutionGraph,
  type PipelineResult,
  type UploadedFile,
} from '@coach/pipeline';

export interface Dataset {
  /** Stage-6 enriched execution graph — the substance the store queries. */
  readonly graph: ExecutionGraph;
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

/** Loads every file under `dir` and runs the full pipeline, returning every
 *  stage's output — the directory load uses this to also dump the stage files. */
export function loadPipelineResult(dir: string): PipelineResult {
  return runPipeline(gatherFiles(dir, dir));
}

// Each directory is rooted at its own parent so file `path`s keep the source
// directory's name as a prefix — this preserves the per-directory grouping the
// route stage relies on (OTEL logs attach to traces by directory) while keeping
// files from different worktrees distinct and traceable in one combined run.
function gatherFromDirs(dirs: readonly string[]): UploadedFile[] {
  return dirs.flatMap((dir) => gatherFiles(dir, dirname(dir)));
}

/** Loads every file under all `dirs` and runs one pipeline over the union — used
 *  to fold a repo's main checkout and its worktrees into a single dataset. */
export function loadPipelineResultFromDirs(dirs: readonly string[]): PipelineResult {
  return runPipeline(gatherFromDirs(dirs));
}

/** Loads every file under `dir` and runs the full pipeline over them. */
export function loadDataset(dir: string): Dataset {
  return { graph: loadPipelineResult(dir).enrichedGraph };
}
