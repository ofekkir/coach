// Filesystem intake. Reads directories of trace/native files off disk into the
// flat UploadedFile[] the browser upload produces, and runs the pipeline. This is
// the pipeline's one `node:*` surface — kept in its own module so consumers that
// only render a pre-computed graph (the browser app) never reach it, while CLIs
// and the MCP server share one directory→PipelineResult path instead of each
// re-implementing the gather.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { runPipeline, type PipelineResult } from '../orchestrate.ts';
import type { UploadedFile } from '../types.ts';

import { resolveRepoDirs, type ResolveOptions } from './resolve-dataset.ts';

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
 *  stage's output. */
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

/** What a single-source load resolved to: the directories actually read (a repo
 *  source folds in its worktrees) and the pipeline output over their union. */
export interface LoadedDataset {
  readonly dirs: readonly string[];
  readonly result: PipelineResult;
}

function isExistingDir(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** One-call intake for a CLI or agent given a single source string: an existing
 *  directory is loaded literally; anything else is treated as a repo name (or
 *  absolute repo path) and resolved to its Claude Code logs — the main checkout
 *  plus every git worktree by default. Mirrors the MCP `load_dataset` convenience
 *  in one positional. */
export function loadFromSource(source: string, options?: ResolveOptions): LoadedDataset {
  if (isExistingDir(source)) return { dirs: [source], result: loadPipelineResult(source) };
  const { dirs } = resolveRepoDirs(source, options);
  return { dirs, result: loadPipelineResultFromDirs(dirs) };
}
