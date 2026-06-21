// The server's mutable state: the one dataset currently loaded. `load_dataset`
// swaps it (running the pipeline over a directory and rebuilding the DuckDB
// store); every data-bound tool reads through `dataset()` / `store()`, which
// throw a clear message until something is loaded. Load-once / serve-many — one
// dataset at a time, replaced on each load.

import type { Store } from './query-core.ts';
import { loadDataset, type Dataset } from './load.ts';
import { createStore } from './store.ts';

/** What `load_dataset` reports back: where it loaded from and how much it found. */
export interface DatasetSummary {
  readonly dir: string;
  readonly kind: string;
  readonly sessions: number;
  readonly interactions: number;
  readonly nodes: number;
}

export interface Session {
  /** Run the pipeline over `dir` and make the resulting graph queryable. */
  load(dir: string): Promise<DatasetSummary>;
  dataset(): Dataset;
  store(): Store;
  close(): void;
}

function summarize(dir: string, dataset: Dataset): DatasetSummary {
  const { graph, analysis } = dataset;
  return {
    dir,
    kind: graph.kind,
    sessions: analysis.sessions.length,
    interactions: analysis.sessions.reduce((n, s) => n + s.interactions.length, 0),
    nodes: Object.keys(graph.nodes).length,
  };
}

const NOT_LOADED = 'no dataset loaded — call load_dataset with a directory path first';

/** Creates an empty session. Tools bind to this; `load` populates it. */
export function createSession(): Session {
  let current: { dir: string; dataset: Dataset; store: Store } | null = null;

  function require(): { dir: string; dataset: Dataset; store: Store } {
    if (current == null) throw new Error(NOT_LOADED);
    return current;
  }

  return {
    load: async (dir) => {
      const dataset = loadDataset(dir);
      const store = await createStore(dataset.graph);
      current?.store.close();
      current = { dir, dataset, store };
      return summarize(dir, dataset);
    },
    dataset: () => require().dataset,
    store: () => require().store,
    close: () => {
      current?.store.close();
      current = null;
    },
  };
}
