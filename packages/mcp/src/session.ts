// The server's mutable state: the one dataset currently loaded. `load_dataset`
// swaps it; every data-bound tool reads through `dataset()` / `store()`, which
// throw a clear message until something is loaded. Load-once / serve-many — one
// dataset at a time, replaced on each load. A path is loaded one of two ways:
//   *.db   — a pre-built coach DB, opened UNTOUCHED (no pipeline); graph recovered
//            from `_coach_meta`, analysis recomputed (cheap) for the graph tools.
//   a dir  — trace/native files run through the pipeline, then materialized.

import { analyzeGraph } from '@coach/pipeline';
import type { Store } from './query-core.ts';
import { loadDataset, type Dataset } from './load.ts';
import { openPersistedStore } from './duckdb.ts';
import { createStore } from './store.ts';

const DB_SUFFIX = '.db';

/** What `load_dataset` reports back: where it loaded from and how much it found. */
export interface DatasetSummary {
  readonly dir: string;
  readonly kind: string;
  readonly sessions: number;
  readonly interactions: number;
  readonly nodes: number;
}

export interface Session {
  /** Make a dataset queryable: a `.db` is opened untouched; a directory is run
   *  through the pipeline first. */
  load(path: string): Promise<DatasetSummary>;
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

const NOT_LOADED = 'no dataset loaded — call load_dataset with a directory or a .db path first';

interface Loaded {
  readonly dataset: Dataset;
  readonly store: Store;
}

async function loadFromDb(path: string): Promise<Loaded> {
  const { store, graph } = await openPersistedStore(path);
  return { dataset: { graph, analysis: analyzeGraph(graph) }, store };
}

async function loadFromDir(path: string): Promise<Loaded> {
  const dataset = loadDataset(path);
  return { dataset, store: await createStore(dataset.graph) };
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
      const { dataset, store } = path.endsWith(DB_SUFFIX)
        ? await loadFromDb(path)
        : await loadFromDir(path);
      current?.store.close();
      current = { dir: path, dataset, store };
      return summarize(path, dataset);
    },
    dataset: () => require().dataset,
    store: () => require().store,
    close: () => {
      current?.store.close();
      current = null;
    },
  };
}
