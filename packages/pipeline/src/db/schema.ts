// The relational schema the store exposes to an analyst agent. This file is the
// AGGREGATOR: each table/view spec lives in its own file under `tables/` and
// `views/` (one relation per file); `schema.ts` imports them and orders them into
// `TABLES`. `TABLES` is the SINGLE SOURCE OF TRUTH — a backend builds the DuckDB
// relations from it (via `materialize.ts`), and the MCP's `describe_schema` tool
// renders the same specs, so the DDL the data lives in and the schema the agent
// reads can never drift. The execution graph (stage 6) is already a normalized,
// id-keyed relational model (see ARCHITECTURE.md); these relations are that model
// queryable:
//   nodes / deltas / semantics       — the three id-keyed node-data layers
//   containment / causal_edges       — the two edge relations over those nodes
//   threads                          — layout lanes (grouping, not causality)
//   agents / sessions                — the dimension entities (FK targets, not nodes)
//   interaction_metrics              — derived per-interaction rollup, a VIEW over `nodes`
//   llm_requests / tools / interactions — per-type VIEWs (typed projections of `nodes`)

import type { TableSpec } from './spec.ts';
import { AGENTS } from './tables/agents.ts';
import { CAUSAL_EDGES } from './tables/causal-edges.ts';
import { CONTAINMENT } from './tables/containment.ts';
import { DELTAS } from './tables/deltas.ts';
import { NODES } from './tables/nodes.ts';
import { SEMANTICS } from './tables/semantics.ts';
import { SESSIONS } from './tables/sessions.ts';
import { THREADS } from './tables/threads.ts';
import { INTERACTION_METRICS } from './views/interaction-metrics.ts';
import { INTERACTIONS } from './views/interactions.ts';
import { LLM_REQUESTS } from './views/llm-requests.ts';
import { TOOLS } from './views/tools.ts';

// Materialized tables first, then VIEWs — every view selects from `nodes` (created
// first), so the relations a view reads already exist when `materializeSql` emits it.
export const TABLES: readonly TableSpec[] = [
  NODES,
  DELTAS,
  SEMANTICS,
  CONTAINMENT,
  CAUSAL_EDGES,
  THREADS,
  AGENTS,
  SESSIONS,
  INTERACTION_METRICS,
  LLM_REQUESTS,
  TOOLS,
  INTERACTIONS,
];
