// Why: this is the one place in the MCP that touches the filesystem; everything
// downstream is graph-only, so disk access must not leak past this module.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

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

/** Loads every file under `dir` and runs the full pipeline over them. */
export function loadDataset(dir: string): Dataset {
  return { graph: loadPipelineResult(dir).enrichedGraph };
}
