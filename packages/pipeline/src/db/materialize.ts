// Graph → SQL. Turns a stage-6 ExecutionGraph into the ordered CREATE + INSERT
// statements that load it into DuckDB. Pure string generation, driven entirely by
// the `TABLES` specs in `schema.ts` — add a column there and it flows through here.
//
// Records are sparse: a column absent from a record serializes to NULL, so each
// builder only sets the columns its node/edge type actually has.

import type { Action, IntentCategory } from '@coach/semantics';
import type { Agent, CanonicalNode, Session } from '../types.ts';
import type { ExecutionGraph, InteractionExecution } from '../graph/types.ts';
import { extractBashCommand, extractFilePath, parseToolInput } from '../graph/semantic/derive.ts';
import { TABLES } from './schema.ts';
import type { ColumnSpec, TableSpec } from './spec.ts';
import { seqByNodeId } from './seq.ts';
import { filePathFromToolInput, normalizeRepoPath } from './repo-path.ts';

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

// BIGINT columns hold nanosecond timestamps that overflow JS `number` and DuckDB
// DOUBLE, so the value arrives as a digit string (the ns VARCHAR) and is emitted as
// a bare integer literal — never round-tripped through a JS number.
function bigintLiteral(value: unknown): string {
  if (value == null) return 'NULL';
  if (typeof value !== 'string' && typeof value !== 'number') return 'NULL';
  const digits = String(value);
  return /^-?\d+$/.test(digits) ? digits : 'NULL';
}

function booleanLiteral(value: unknown): string {
  return typeof value !== 'boolean' ? 'NULL' : value ? 'TRUE' : 'FALSE';
}

function columnLiteral(column: ColumnSpec, value: unknown): string {
  if (column.sqlType === 'JSON')
    return value == null ? 'NULL' : `CAST(${sqlString(JSON.stringify(value))} AS JSON)`;
  if (column.sqlType === 'BIGINT') return bigintLiteral(value);
  if (column.sqlType === 'BOOLEAN') return booleanLiteral(value);
  return sqlScalar(value);
}

// ── DDL + DML generation ─────────────────────────────────────────────────────

function createTableSql(table: TableSpec): string {
  const columns = table.columns.map((c) => `${c.name} ${c.sqlType}`).join(', ');
  return `CREATE TABLE ${table.name} (${columns})`;
}

function createViewSql(table: TableSpec): string {
  return `CREATE VIEW ${table.name} AS ${table.view ?? ''}`;
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

function typeNodeRecord(
  node: CanonicalNode,
  action: Action | undefined,
  cwd: string | undefined,
  intent: IntentCategory | undefined,
): Record<string, unknown> {
  if (node.type === 'llm_request')
    return {
      model: node.model,
      source: node.source,
      stop_reason: node.stop_reason,
      tokens_in: node.tokens_in,
      tokens_out: node.tokens_out,
      cost_usd: node.cost_usd,
    };
  if (node.type === 'tool') {
    const input = parseToolInput(node.tool_input);
    return {
      name: node.name,
      tool_use_id: node.tool_use_id,
      tool_input: node.tool_input,
      file_path: extractFilePath(input),
      bash_command: extractBashCommand(input),
      action: action ?? 'other',
      is_error: node.is_error,
      error_kind: node.error_kind,
      output_size: node.output_size,
      error_message: node.error_message,
      repo_path: normalizeRepoPath(filePathFromToolInput(node.tool_input), cwd),
    };
  }
  if (node.type === 'hook') return { name: node.name };
  if (node.type === 'interaction')
    return { sequence: node.sequence, prompt: node.prompt, intent_category: intent ?? 'other' };
  return {};
}

function nodeRecord(
  node: CanonicalNode,
  actions: Readonly<Record<string, Action>>,
  intents: Readonly<Record<string, IntentCategory>>,
  seq: Map<string, number>,
  cwdBySession: ReadonlyMap<string, string | undefined>,
): Record<string, unknown> {
  return {
    ...baseNodeRecord(node),
    ...typeNodeRecord(node, actions[node.id], cwdBySession.get(node.sessionId), intents[node.id]),
    seq: seq.get(node.id),
  };
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

export function buildRecords(graph: ExecutionGraph): Record<string, Record<string, unknown>[]> {
  const nodes = Object.values(graph.nodes);
  const { agents, sessions, interactions } = collectStructure(graph);
  const seq = seqByNodeId(nodes);
  const cwdBySession = new Map(sessions.map((s) => [s.id, s.cwd]));
  return {
    nodes: nodes.map((node) => nodeRecord(node, graph.actions, graph.intents, seq, cwdBySession)),
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
      cwd: s.cwd,
      branch: s.branch,
    })),
  };
}

/**
 * The ordered DDL + DML that load `graph` into a fresh DuckDB. Materialized tables
 * emit CREATE TABLE + INSERTs; `view` specs emit a single CREATE VIEW (computed on
 * read against `nodes`, no rows). Views appear after `nodes` in `TABLES`, so the
 * relation they select from already exists when the view is created.
 */
export function materializeSql(graph: ExecutionGraph): string[] {
  const records = buildRecords(graph);
  return TABLES.flatMap((table) =>
    table.view != null
      ? [createViewSql(table)]
      : [createTableSql(table), ...insertStatements(table, records[table.name] ?? [])],
  );
}
