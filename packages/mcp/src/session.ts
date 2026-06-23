// The server's mutable state: the one dataset currently loaded. `load_dataset`
// swaps it; every data-bound tool reads through `dataset()` / `store()`, which
// throw a clear message until something is loaded. Load-once / serve-many — one
// dataset at a time, replaced on each load. A load always re-derives from source:
// the directory's trace/native files run through the pipeline, then materialized.

import type { ExecutionGraph } from '@coach/pipeline';

import { dumpPipelineOutputs } from './dump.ts';
import { loadPipelineResult, type Dataset } from './load.ts';
import { outputDir } from './output-dir.ts';
import type { Store } from './query-core.ts';
import { createStore } from './store.ts';

/** What `load_dataset` reports back: where it loaded from and how much it found. */
export interface DatasetSummary {
  readonly dir: string;
  readonly kind: string;
  readonly sessions: number;
  readonly interactions: number;
  readonly nodes: number;
  /** The stage JSON + `.db` files written to the gitignored `out/` dir, so the
   *  agent can `open_viz` them. */
  readonly dumped?: readonly string[];
}

export interface Session {
  /** Make a dataset queryable: a `.db` is opened untouched; a directory is run
   *  through the pipeline first. */
  load(path: string): Promise<DatasetSummary>;
  dataset(): Dataset;
  store(): Store;
  close(): void;
}

// Counts come straight off the node table — distinct session FKs and the
// interaction nodes — so the summary needs no separate analysis pass.
function summarize(dir: string, graph: ExecutionGraph, dumped: readonly string[]): DatasetSummary {
  const nodes = Object.values(graph.nodes);
  return {
    dir,
    kind: graph.kind,
    sessions: new Set(nodes.map((n) => n.sessionId)).size,
    interactions: nodes.filter((n) => n.type === 'interaction').length,
    nodes: nodes.length,
    dumped,
  };
}

const NOT_LOADED =
  'no dataset loaded — call load_dataset with a directory of trace/native files first';

interface Loaded {
  readonly dataset: Dataset;
  readonly store: Store;
  readonly dumped: readonly string[];
}

// A load re-derives the dataset: run the pipeline over the directory, dump the
// stage outputs + `.db` into the gitignored `out/` dir (so `open_viz` can serve
// them without polluting the run dir), and make the graph queryable through a
// fresh temp DuckDB.
async function loadFromDir(path: string): Promise<Loaded> {
  const result = loadPipelineResult(path);
  const dataset: Dataset = { graph: result.enrichedGraph };
  const dumped = await dumpPipelineOutputs(result, outputDir());
  return { dataset, store: await createStore(dataset.graph), dumped };
}

/** Creates an empty session. Tools bind to this; `load` populates it. */
export function createSession(): Session {
  let current: { dir: string; dataset: Dataset; store: Store } | null = null;

  function require(): { dir: string; dataset: Dataset; store: Store } {
    if (current == null) throw new Error(NOT_LOADED);
    return current;
  }

  return {
    load: async (path) => {
      const { dataset, store, dumped } = await loadFromDir(path);
      current?.store.close();
      current = { dir: path, dataset, store };
      return summarize(path, dataset.graph, dumped);
    },
    dataset: () => require().dataset,
    store: () => require().store,
    close: () => {
      current?.store.close();
      current = null;
    },
  };
}
