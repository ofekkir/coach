// Graph → SQL. Turns a stage-6 ExecutionGraph into the ordered CREATE + INSERT
// statements that load it into DuckDB. Pure string generation, driven entirely by
// the `TABLES` specs in `schema.ts` — add a column there and it flows through here.
//
// Records are sparse: a column absent from a record serializes to NULL, so each
// builder only sets the columns its node/edge type actually has.

import type { Agent, CanonicalNode, Session } from '../types.ts';
import type { ExecutionGraph, InteractionExecution } from '../graph/types.ts';
import { TABLES, type ColumnSpec, type TableSpec } from './schema.ts';

const INSERT_CHUNK = 200;

// ── SQL literal encoding ─────────────────────────────────────────────────────

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlScalar(value: unknown): string {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return sqlString(value);
  return sqlString(JSON.stringify(value));
}

function booleanLiteral(value: unknown): string {
  if (typeof value !== 'boolean') return 'NULL';
  return value ? 'TRUE' : 'FALSE';
}

function columnLiteral(column: ColumnSpec, value: unknown): string {
  if (column.sqlType === 'JSON')
    return value == null ? 'NULL' : `CAST(${sqlString(JSON.stringify(value))} AS JSON)`;
  if (column.sqlType === 'BOOLEAN') return booleanLiteral(value);
  return sqlScalar(value);
}

// ── DDL + DML generation ─────────────────────────────────────────────────────

function createTableSql(table: TableSpec): string {
  const columns = table.columns.map((c) => `${c.name} ${c.sqlType}`).join(', ');
  return `CREATE TABLE ${table.name} (${columns})`;
}

function rowLiteral(columns: readonly ColumnSpec[], row: Record<string, unknown>): string {
  return `(${columns.map((c) => columnLiteral(c, row[c.name])).join(', ')})`;
}

function insertStatements(table: TableSpec, rows: readonly Record<string, unknown>[]): string[] {
  const columnList = table.columns.map((c) => c.name).join(', ');
  const statements: string[] = [];
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    const values = rows
      .slice(start, start + INSERT_CHUNK)
      .map((row) => rowLiteral(table.columns, row))
      .join(',\n');
    statements.push(`INSERT INTO ${table.name} (${columnList}) VALUES\n${values}`);
  }
  return statements;
}

// ── Graph → row records (one builder per table) ──────────────────────────────

function baseNodeRecord(node: CanonicalNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    parent: node.parent,
    session_id: node.sessionId,
    interaction_id: node.interactionId,
    start_time_ns: node.start_time_ns,
    end_time_ns: node.end_time_ns,
    duration_ms: node.duration_ms,
    data: node,
  };
}

function typeNodeRecord(node: CanonicalNode): Record<string, unknown> {
  if (node.type === 'llm_request')
    return {
      model: node.model,
      source: node.source,
      stop_reason: node.stop_reason,
      tokens_in: node.tokens_in,
      tokens_out: node.tokens_out,
      cost_usd: node.cost_usd,
    };
  if (node.type === 'tool')
    return {
      name: node.name,
      tool_use_id: node.tool_use_id,
      tool_input: node.tool_input,
      is_error: node.is_error,
      error_kind: node.error_kind,
      result_summary: node.result_summary,
    };
  if (node.type === 'hook') return { name: node.name };
  if (node.type === 'interaction') return { sequence: node.sequence, prompt: node.prompt };
  return {};
}

function nodeRecord(node: CanonicalNode): Record<string, unknown> {
  return { ...baseNodeRecord(node), ...typeNodeRecord(node) };
}

interface GraphStructure {
  readonly agents: readonly Agent[];
  readonly sessions: readonly Session[];
  readonly interactions: readonly InteractionExecution[];
}

function collectStructure(graph: ExecutionGraph): GraphStructure {
  if (graph.kind === 'agent')
    return {
      agents: [graph.data.agent],
      sessions: graph.data.sessions.map((s) => s.session),
      interactions: graph.data.sessions.flatMap((s) => [...s.interactions]),
    };
  if (graph.kind === 'session')
    return {
      agents: [],
      sessions: [graph.data.session],
      interactions: [...graph.data.interactions],
    };
  return { agents: [], sessions: [], interactions: graph.data != null ? [graph.data] : [] };
}

function threadRecords(interaction: InteractionExecution): Record<string, unknown>[] {
  return interaction.threads.flatMap((thread) =>
    thread.members.map((member, position) => ({
      thread_id: thread.id,
      interaction_id: interaction.interactionId,
      source: thread.source,
      node_id: member.id,
      position,
    })),
  );
}

function buildRecords(graph: ExecutionGraph): Record<string, Record<string, unknown>[]> {
  const nodes = Object.values(graph.nodes);
  const { agents, sessions, interactions } = collectStructure(graph);
  return {
    nodes: nodes.map(nodeRecord),
    deltas: Object.entries(graph.deltas).map(([id, d]) => ({
      id,
      request_messages_delta: d.requestMessagesDelta,
      response_messages_delta: d.responseMessagesDelta,
    })),
    semantics: Object.entries(graph.semantics).map(([id, s]) => ({
      id,
      what: s.what,
      comment: s.comment,
    })),
    containment: nodes
      .filter((n) => n.parent != null)
      .map((n) => ({ parent_id: n.parent, child_id: n.id })),
    causal_edges: interactions.flatMap((i) =>
      i.causalEdges.map((e) => ({ from_id: e.fromId, to_id: e.toId, gap_ms: e.gapMs })),
    ),
    threads: interactions.flatMap(threadRecords),
    agents: agents.map((a) => ({ id: a.id, user_id: a.userId })),
    sessions: sessions.map((s) => ({
      id: s.id,
      agent_id: s.agentId,
      user_id: s.userId,
      session_id: s.sessionId,
      title: s.title,
    })),
  };
}

/** The ordered CREATE + INSERT statements that load `graph` into a fresh DuckDB. */
export function materializeSql(graph: ExecutionGraph): string[] {
  const records = buildRecords(graph);
  return TABLES.flatMap((table) => [
    createTableSql(table),
    ...insertStatements(table, records[table.name] ?? []),
  ]);
}
