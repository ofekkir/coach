// In-memory dataset session for the HTTP server. The browser uploads file
// contents; we run the pipeline once and hold the resulting read-only store plus
// the render views. Single dataset at a time, replaced on each load — the same
// load-once/serve-many shape as the MCP session, but keyed on uploaded file
// contents instead of a directory path (so it runs without disk access).

import {
  runPipeline,
  type PipelineResult,
  type UploadedFile,
  type VizResult,
} from '@coach/pipeline';
import { createStore, type Store } from '@coach/mcp';

export interface LoadSummary {
  readonly kind: string;
  readonly sessions: number;
  readonly interactions: number;
  readonly nodes: number;
}

export interface ServerSession {
  load(files: readonly UploadedFile[]): Promise<LoadSummary>;
  store(): Store;
  views(): VizResult[];
  close(): void;
}

const NOT_LOADED = 'no dataset loaded — POST /api/load first';

// Mirrors @coach/pipeline's buildVizResults from a single pipeline run. The
// server's integration test asserts parity with buildVizResults, so this cannot
// silently drift while avoiding a second pipeline pass.
function viewsFrom(result: PipelineResult): VizResult[] {
  if (result.agentGraph.sessions.length === 0) return [];
  const title = result.agentGraph.agent.userId || 'agent';
  return [{ title, data: result.enrichedGraph }];
}

function summarize(result: PipelineResult): LoadSummary {
  const interactions = result.analysis.sessions.reduce((n, s) => n + s.interactions.length, 0);
  return {
    kind: result.enrichedGraph.kind,
    sessions: result.analysis.sessions.length,
    interactions,
    nodes: Object.keys(result.enrichedGraph.nodes).length,
  };
}

interface Loaded {
  readonly store: Store;
  readonly views: VizResult[];
}

/** Creates an empty session. `load` populates it; reads throw until then. */
export function createServerSession(): ServerSession {
  let current: Loaded | null = null;
  function loaded(): Loaded {
    if (current == null) throw new Error(NOT_LOADED);
    return current;
  }
  return {
    load: async (files) => {
      const result = runPipeline(files);
      const store = await createStore(result.enrichedGraph);
      current?.store.close();
      current = { store, views: viewsFrom(result) };
      return summarize(result);
    },
    store: () => loaded().store,
    views: () => loaded().views,
    close: () => {
      current?.store.close();
      current = null;
    },
  };
}
