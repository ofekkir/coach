// The relational schema the store exposes to an analyst agent. This is the SINGLE
// SOURCE OF TRUTH: a backend builds the DuckDB tables from `TABLES` (via
// `materialize.ts`), and the MCP's `describe_schema` tool renders the very same
// specs — so the DDL the data lives in and the schema the agent reads can never
// drift. The execution graph (stage 6) is already a normalized, id-keyed
// relational model (see ARCHITECTURE.md); these tables are that model queryable:
//   nodes / deltas / semantics  — the three id-keyed node-data layers
//   containment / causal_edges  — the two edge relations over those nodes
//   threads                     — layout lanes (grouping, not causality)
//   agents / sessions           — the dimension entities (FK targets, not nodes)

import { NODES } from './nodes-table.ts';

export interface ColumnSpec {
  readonly name: string;
  /** DuckDB column type. `JSON` columns are populated from a JS value via CAST. */
  readonly sqlType: 'VARCHAR' | 'DOUBLE' | 'INTEGER' | 'BIGINT' | 'BOOLEAN' | 'JSON';
  readonly doc: string;
}

export interface TableSpec {
  readonly name: string;
  readonly doc: string;
  readonly columns: readonly ColumnSpec[];
}

const DELTAS: TableSpec = {
  name: 'deltas',
  doc: 'Stage-5 message deltas. Sparse — only llm_request nodes get a row. The messages new to this request relative to the previous request in its thread.',
  columns: [
    { name: 'id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (an llm_request).' },
    {
      name: 'request_messages_delta',
      sqlType: 'JSON',
      doc: 'Request messages beyond the previous request (the first carries its full array).',
    },
    {
      name: 'response_messages_delta',
      sqlType: 'JSON',
      doc: 'The full response (each response is all-new).',
    },
  ],
};

const SEMANTICS: TableSpec = {
  name: 'semantics',
  doc: "Stage-6 semantic labels. Sparse — only relabeled (tool / llm_request) nodes get a row; the presence of a row IS the 'is this enriched?' flag. `what` values come from the closed ontology vocabulary (see describe_schema → vocabulary).",
  columns: [
    { name: 'id', sqlType: 'VARCHAR', doc: 'FK → nodes.id.' },
    {
      name: 'what',
      sqlType: 'JSON',
      doc: 'Ordered list of atomic action phrases, e.g. ["fetch ynet.co.il","summarize headlines"].',
    },
    {
      name: 'comment',
      sqlType: 'VARCHAR',
      doc: 'Optional agent-authored annotation harvested verbatim (e.g. a Bash `description`). Display signal only.',
    },
  ],
};

const CONTAINMENT: TableSpec = {
  name: 'containment',
  doc: 'The containment relation ("parent contains child in time"), derived from the node `parent` self-FK. Exactly one parent per child. Walk it with the `subtree` tool or a recursive CTE.',
  columns: [
    { name: 'parent_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (the container).' },
    { name: 'child_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (contained).' },
  ],
};

const CAUSAL_EDGES: TableSpec = {
  name: 'causal_edges',
  doc: 'The causal DAG ("cause triggers effect") — the only edge layer with causal meaning (time-adjacency is NOT causality). Inference→tool fan-out, tool→inference fan-in (by tool_use_id), inference→inference continuation, prompt→turn. Walk it with the `causal_path` tool.',
  columns: [
    { name: 'from_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (the cause).' },
    { name: 'to_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (the effect).' },
    {
      name: 'gap_ms',
      sqlType: 'DOUBLE',
      doc: 'Signed gap cause-end → effect-start (often negative for fan-out dispatched mid-stream).',
    },
  ],
};

const THREADS: TableSpec = {
  name: 'threads',
  doc: 'Layout lanes — a grouping of an interaction\'s steps into an execution lane (e.g. "repl_main_thread"). Membership only; adjacency here is NOT causality.',
  columns: [
    { name: 'thread_id', sqlType: 'VARCHAR', doc: 'Thread id.' },
    { name: 'interaction_id', sqlType: 'VARCHAR', doc: 'FK → owning interaction node id.' },
    { name: 'source', sqlType: 'VARCHAR', doc: "The loop that emitted the lane's inferences." },
    { name: 'node_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (a top-level member of the lane).' },
    {
      name: 'position',
      sqlType: 'INTEGER',
      doc: '0-based order of the member within the lane (time order).',
    },
  ],
};

const AGENTS: TableSpec = {
  name: 'agents',
  doc: 'The agent dimension entity — a FK target, never a node. Single-agent today.',
  columns: [
    { name: 'id', sqlType: 'VARCHAR', doc: 'Agent id.' },
    { name: 'user_id', sqlType: 'VARCHAR', doc: 'The user behind the agent.' },
  ],
};

const SESSIONS: TableSpec = {
  name: 'sessions',
  doc: 'The session dimension entity — a FK target referenced by nodes.session_id, never a node.',
  columns: [
    {
      name: 'id',
      sqlType: 'VARCHAR',
      doc: 'Session entity id (the value carried as nodes.session_id).',
    },
    { name: 'agent_id', sqlType: 'VARCHAR', doc: 'FK → agents.id.' },
    { name: 'user_id', sqlType: 'VARCHAR', doc: 'The user behind the session.' },
    { name: 'session_id', sqlType: 'VARCHAR', doc: "The harness's own session id." },
    { name: 'title', sqlType: 'VARCHAR', doc: 'Optional session title.' },
    // prettier-ignore
    { name: 'cwd', sqlType: 'VARCHAR', doc: 'Absolute working directory the session ran in. Populated for native Claude sessions; NULL for OTEL traces (no cwd attribute).' },
    // prettier-ignore
    { name: 'branch', sqlType: 'VARCHAR', doc: 'Git branch the session ran on. Populated for native Claude sessions; NULL for OTEL traces (no branch attribute).' },
  ],
};

export const TABLES: readonly TableSpec[] = [
  NODES,
  DELTAS,
  SEMANTICS,
  CONTAINMENT,
  CAUSAL_EDGES,
  THREADS,
  AGENTS,
  SESSIONS,
];
