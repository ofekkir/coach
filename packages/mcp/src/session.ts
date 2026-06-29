// The server's mutable state: the one dataset currently loaded. `load_dataset`
// swaps it; every data-bound tool reads through `dataset()` / `store()`, which
// throw a clear message until something is loaded. Load-once / serve-many — one
// dataset at a time, replaced on each load. A load always re-derives from source:
// the directory's trace/native files run through the pipeline, then materialized.

import {
  loadPipelineResult,
  loadPipelineResultFromDirs,
  resolveRepoDirs,
  type ExecutionGraph,
  type PipelineResult,
  type ResolveOptions,
} from '@coach/pipeline';

import { dumpPipelineOutputs } from './dump.ts';
import type { Dataset } from './load.ts';
import { outputDir } from './output-dir.ts';
import type { Store } from './query-core.ts';
import { createStore } from './store.ts';

/** What `load_dataset` reports back: where it loaded from and how much it found. */
export interface DatasetSummary {
  /** The repo name or path requested. */
  readonly source: string;
  /** The directories actually loaded (a repo load folds in its worktrees). */
  readonly dirs: readonly string[];
  readonly kind: string;
  readonly sessions: number;
  readonly interactions: number;
  readonly nodes: number;
  /** The stage JSON + `.db` files written to the gitignored `out/` dir, so the
   *  agent can `open_viz` them. */
  readonly dumped?: readonly string[];
}

export interface Session {
  /** Load a single directory of trace/native files, running it through the pipeline. */
  load(path: string): Promise<DatasetSummary>;
  /** Load a repo by name (or absolute path): the main checkout plus, by default,
   *  every git worktree, folded into one dataset. */
  loadRepo(query: string, options?: ResolveOptions): Promise<DatasetSummary>;
  dataset(): Dataset;
  store(): Store;
  close(): void;
}

// Counts come straight off the node table — distinct session FKs and the
// interaction nodes — so the summary needs no separate analysis pass.
function summarize(
  source: string,
  dirs: readonly string[],
  graph: ExecutionGraph,
  dumped: readonly string[],
): DatasetSummary {
  const nodes = Object.values(graph.nodes);
  return {
    source,
    dirs,
    kind: graph.kind,
    sessions: new Set(nodes.map((n) => n.sessionId)).size,
    interactions: nodes.filter((n) => n.type === 'interaction').length,
    nodes: nodes.length,
    dumped,
  };
}

const NOT_LOADED =
  'no dataset loaded — call load_dataset with a repo name (loads all worktrees) or a directory first';

interface Loaded {
  readonly dataset: Dataset;
  readonly store: Store;
  readonly dumped: readonly string[];
}

// A load re-derives the dataset: run the pipeline over the source files, dump the
// stage outputs + `.db` into the gitignored `out/` dir (so `open_viz` can serve
// them without polluting the run dir), and make the graph queryable through a
// fresh temp DuckDB.
async function buildLoaded(result: PipelineResult): Promise<Loaded> {
  const dataset: Dataset = { graph: result.enrichedGraph };
  const dumped = await dumpPipelineOutputs(result, outputDir());
  return { dataset, store: await createStore(dataset.graph), dumped };
}

/** Creates an empty session. Tools bind to this; `load`/`loadRepo` populate it. */
export function createSession(): Session {
  let current: { dataset: Dataset; store: Store } | null = null;

  function require(): { dataset: Dataset; store: Store } {
    if (current == null) throw new Error(NOT_LOADED);
    return current;
  }

  async function swapIn(
    source: string,
    dirs: readonly string[],
    result: PipelineResult,
  ): Promise<DatasetSummary> {
    const { dataset, store, dumped } = await buildLoaded(result);
    current?.store.close();
    current = { dataset, store };
    return summarize(source, dirs, dataset.graph, dumped);
  }

  return {
    load: (path) => swapIn(path, [path], loadPipelineResult(path)),
    loadRepo: (query, options) => {
      const { dirs } = resolveRepoDirs(query, options);
      return swapIn(query, dirs, loadPipelineResultFromDirs(dirs));
    },
    dataset: () => require().dataset,
    store: () => require().store,
    close: () => {
      current?.store.close();
      current = null;
    },
  };
}
