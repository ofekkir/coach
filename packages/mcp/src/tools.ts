// The analyst-facing tool surface. Seven tools over the session's current
// dataset: load it, describe the schema, run read-only SQL, and four graph
// primitives. The point is flexibility — the agent loads data and composes its
// own queries instead of consuming a fixed set of hardcoded findings. The stage-7
// analysis is still available verbatim through `get_analysis`, but as one option
// among many, not the only way in.
//
// Tools carry a Zod input shape; the MCP layer (server.ts) validates args against
// it before dispatch. Data-bound tools read through the session, which throws a
// clear message until a dataset is loaded.

import { z, type ZodRawShape } from 'zod';
import { resolve as resolveNode, type GraphAnalysis } from '@coach/pipeline';
import { defaultSemanticsConfig } from '@coach/semantics';
import { TABLES, type CausalDirection } from '@coach/store';
import type { Session } from './session.ts';
import { EXAMPLE_QUERIES } from './examples.ts';

export interface Tool {
  readonly name: string;
  readonly description: string;
  /** Zod raw shape for the tool's arguments (validated by the MCP layer). */
  readonly inputShape: ZodRawShape;
  handle(args: Record<string, unknown>): Promise<unknown>;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`'${key}' must be a non-empty string`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

const ID_SHAPE = { id: z.string().describe('A node id.') };

// ── describe_schema ──────────────────────────────────────────────────────────

function schemaDescription(): unknown {
  const ontology = defaultSemanticsConfig.ontology;
  return {
    overview:
      'A normalized, id-keyed relational model of agent execution. Every node carries session_id and interaction_id FKs, so per-scope aggregation is a flat filter. Join layers by node id. Load data with `load_dataset`, then query with `query` (read-only SQL); walk the tree/DAG with `subtree` / `causal_path`.',
    tables: TABLES.map((t) => ({ name: t.name, doc: t.doc, columns: t.columns })),
    vocabulary: {
      doc: 'The closed ontology behind the `semantics.what` action phrases. Use it to interpret or filter semantic labels.',
      actions: ontology.actions.map((a) => ({ id: a.id, label: a.label, group: a.group })),
      objects: ontology.objects.map((o) => ({ id: o.id, label: o.label })),
    },
    exampleQueries: EXAMPLE_QUERIES,
    notes: [
      'Read-only: a single SELECT or WITH statement; no `;`-separated statements, no DDL/DML.',
      "Un-promoted node fields live in the `data` JSON column — reach them with json_extract / data->>'$.field'.",
      'Prefer `subtree` and `causal_path` over hand-written recursive CTEs for tree/DAG walks.',
    ],
  };
}

// ── get_analysis ─────────────────────────────────────────────────────────────

function findInteraction(analysis: GraphAnalysis, interactionId: string): unknown {
  for (const session of analysis.sessions) {
    const match = session.interactions.find((i) => i.interactionId === interactionId);
    if (match != null) return match;
  }
  return null;
}

function analysisView(analysis: GraphAnalysis, args: Record<string, unknown>): unknown {
  const interactionId = optionalString(args, 'interactionId');
  if (interactionId != null) return findInteraction(analysis, interactionId);
  const sessionId = optionalString(args, 'sessionId');
  if (sessionId != null) return analysis.sessions.find((s) => s.sessionId === sessionId) ?? null;
  return analysis;
}

// ── Tool registry ────────────────────────────────────────────────────────────

function loadDatasetTool(session: Session): Tool {
  return {
    name: 'load_dataset',
    description:
      'Load a dataset and make it queryable, replacing any previously loaded one. Pass either a pre-built coach DuckDB file (`*.db`, opened untouched — no pipeline run) or a directory of OTEL Tempo traces / native session .jsonl logs (run through the full pipeline). Returns a summary (counts). Call this before querying unless a dataset was preloaded at startup.',
    inputShape: {
      path: z
        .string()
        .describe('Absolute path to a pre-built `.db` file or a directory of trace/native files.'),
    },
    handle: (args) => session.load(stringArg(args, 'path')),
  };
}

function schemaTool(): Tool {
  return {
    name: 'describe_schema',
    description:
      'Return the queryable schema: tables, columns (with docs), the semantic vocabulary, and example queries (including the stage-7 detectors as SQL). Works without a dataset loaded — call it first to plan your queries.',
    inputShape: {},
    handle: () => Promise.resolve(schemaDescription()),
  };
}

function queryTool(session: Session): Tool {
  return {
    name: 'query',
    description:
      'Run a read-only SQL query (a single SELECT or WITH statement) over the loaded execution-graph tables. Results are capped (≤1000 rows and a serialized-byte budget; `truncated` flags when rows were dropped or long cells clipped). See describe_schema for the table/column reference.',
    inputShape: { sql: z.string().describe('A single SELECT/WITH statement.') },
    handle: (args) => session.store().query(stringArg(args, 'sql')),
  };
}

function resolveTool(session: Session): Tool {
  return {
    name: 'resolve',
    description:
      'Resolve one node id across all three layers (node data, message deltas, semantic label) — the full hydrated node.',
    inputShape: ID_SHAPE,
    handle: (args) => Promise.resolve(resolveNode(session.dataset().graph, stringArg(args, 'id'))),
  };
}

function subtreeTool(session: Session): Tool {
  return {
    name: 'subtree',
    description:
      'Return the containment descendants of a node id (what ran within its time span), via the containment relation.',
    inputShape: ID_SHAPE,
    handle: (args) => session.store().subtree(stringArg(args, 'id')),
  };
}

function causalPathTool(session: Session): Tool {
  return {
    name: 'causal_path',
    description:
      'Walk the causal DAG from a node id: `upstream` for the causes that triggered it (default), `downstream` for what it triggered.',
    inputShape: {
      ...ID_SHAPE,
      direction: z.enum(['upstream', 'downstream']).optional().describe('Default upstream.'),
    },
    handle: (args) => {
      const direction = (optionalString(args, 'direction') ?? 'upstream') as CausalDirection;
      return session.store().causalPath(stringArg(args, 'id'), direction);
    },
  };
}

function getAnalysisTool(session: Session): Tool {
  return {
    name: 'get_analysis',
    description:
      'Return the curated stage-7 analysis (rollups, shape, critical path, longest step, repetitions). Optionally narrow to one interactionId or sessionId. A convenience over the raw tables — use `query` for anything it does not cover.',
    inputShape: {
      interactionId: z.string().optional().describe('Narrow to one interaction.'),
      sessionId: z.string().optional().describe('Narrow to one session.'),
    },
    handle: (args) => Promise.resolve(analysisView(session.dataset().analysis, args)),
  };
}

/** Builds the analyst tools bound to one session (its current dataset + store). */
export function createTools(session: Session): Tool[] {
  return [
    loadDatasetTool(session),
    schemaTool(),
    queryTool(session),
    resolveTool(session),
    subtreeTool(session),
    causalPathTool(session),
    getAnalysisTool(session),
  ];
}
