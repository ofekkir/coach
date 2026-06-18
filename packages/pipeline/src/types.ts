/** Nanoseconds per millisecond. OTEL timestamps are ns (bigint); UI gaps/durations are ms. */
export const NS_PER_MS = 1_000_000n;

/** OTLP/W3C identifier byte-lengths (fixed by spec): 8-byte span ids, 16-byte trace ids. */
export const SPAN_ID_BYTES = 8;
export const TRACE_ID_BYTES = 16;

/** Constants of the dependency-free deterministic byte generator (FNV-1a hash → LCG)
 *  used to synthesize stable span/trace ids for native (non-OTEL) inputs. */
export const FNV_OFFSET_BASIS = 2166136261;
export const FNV_PRIME = 16777619;
export const LCG_MULTIPLIER = 1664525;
export const LCG_INCREMENT = 1013904223;
/** Right-shift to take the high byte of a 32-bit word. */
export const HIGH_BYTE_SHIFT = 24;

// ── Pipeline input ──────────────────────────────────────────────────────────

/** A single in-memory file presented by the caller (browser File.text() or Node fs.readFileSync). */
export interface UploadedFile {
  /** Filename only, e.g. "session.jsonl" or "trace-abc123.json". Classification keys on this. */
  name: string;
  /** Full text content of the file. */
  content: string;
  /** Relative path including directory, e.g. "projA/logs.json". Absent for loose top-level files. */
  path?: string;
}

// ── Stage 1: classification ───────────────────────────────────────────────────

/** What an uploaded file is. `unsupported` is carried through (never silently dropped). */
export type InputType = 'otel-trace' | 'otel-log' | 'native' | 'unsupported';

export interface ClassifiedInput {
  readonly file: UploadedFile;
  readonly type: InputType;
}

// ── Stage 2: session routing ──────────────────────────────────────────────────

/** A session is wholly OTEL (logs + traces) or wholly native (one .jsonl). */
type SessionKind = 'otel' | 'native';

export interface SessionInputs {
  readonly sessionId: string;
  readonly kind: SessionKind;
  readonly inputs: readonly ClassifiedInput[];
}

// ── OTLP types (raw input) ────────────────────────────────────────────────────

type OtlpValue =
  | { readonly stringValue: string }
  | { readonly boolValue: boolean }
  | { readonly intValue: string }
  | { readonly doubleValue: number }
  | { readonly arrayValue: { readonly values: readonly OtlpValue[] } };

export interface OtlpAttribute {
  readonly key: string;
  readonly value: OtlpValue;
}

export interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly OtlpAttribute[];
}

export interface OtlpBatch {
  readonly scopeSpans: readonly { readonly spans: readonly OtlpSpan[] }[];
}

// Grafana Tempo's HTTP API response shape for a trace query. This differs from
// the standard OTLP proto JSON mapping (which uses `resourceSpans[]`) — Tempo
// wraps everything in `batches[]` instead.
export interface TempoTrace {
  readonly batches: readonly OtlpBatch[];
}

export interface LogEntry {
  readonly timestamp_ns: number;
  readonly event_sequence: string;
  readonly span_id: string;
  readonly session_id?: string | null;
  readonly event_name: string;
  readonly hook_name?: string | null;
  readonly request_id?: string | null;
  readonly query_source?: string | null;
  readonly body?: string | null;
  readonly tool_name?: string | null;
  readonly prompt?: string | null;
  readonly tool_use_id?: string | null;
  readonly tool_input?: string | null;
  readonly cost_usd?: string | null;
  readonly total_duration_ms?: number | string | null;
}

// ── Entities — dimension rows, NOT graph nodes ────────────────────────────────
// Agent and session are owning entities referenced by foreign key, never nodes in
// the node-data table. Each maps 1:1 to a relational table (`agents`, `sessions`).

export interface Agent {
  readonly id: string;
  readonly userId: string;
}

export interface Session {
  readonly id: string;
  readonly agentId: string; // FK → Agent
  readonly userId: string;
  readonly sessionId: string; // the harness's own session id
  readonly title?: string;
}

/** The `Agent` entity id for a user. The single id namespace shared everywhere. */
export function agentEntityId(userId: string): string {
  return `agent-${userId}`;
}

/** The `Session` entity id for a harness session id — the value carried as the
 *  `sessionId` FK on every node. */
export function sessionEntityId(harnessSessionId: string): string {
  return `session-${harnessSessionId}`;
}

// ── Transformed node (ETL output) ────────────────────────────────────────────
// Agent and session are entities (above), not node types. "Is this node
// enriched?" is answered by the presence of a `semantics[id]` row, so there is no
// `action`/`inference` node type either — the node type stays mechanical.

export type NodeType =
  | 'interaction'
  | 'user_prompt'
  | 'llm_request'
  | 'tool'
  | 'tool.execution'
  | 'tool.blocked_on_user'
  | 'hook';

export interface RequestMessage {
  role: string;
  content: unknown;
}

export interface ResponseMessage {
  type: string;
  [key: string]: unknown;
}

/** Fields shared by every node. `type` is the discriminant; concrete members
 *  narrow it to a literal. Read it directly (`switch (node.type)`) without
 *  narrowing first. `sessionId` is the FK → `Session` (denormalized onto every
 *  node so per-session aggregation is a flat filter, not a parent-walk).
 *  `interactionId` is the same idea one level down — the FK → owning
 *  `InteractionNode` (its own id, for an interaction node). Unlike `sessionId`
 *  (a constant for the whole stage-3 pass), it needs the parent-closure, so it is
 *  added in stage 4 (`aggregate`); absent on raw stage-3 nodes. */
interface BaseNode {
  id: string;
  type: NodeType;
  parent?: string; // containment FK (self-FK → another node)
  sessionId: string; // FK → Session entity
  interactionId?: string; // FK → owning InteractionNode; stamped by stage 4
}

/** Span-derived nodes always carry real OTLP timing — `parse.ts` computes all
 *  three from required span timestamps, so they are never absent here. */
interface SpannedNode extends BaseNode {
  start_time_ns: string;
  end_time_ns: string;
  duration_ms: number;
}

/** Sentinel injected by the native builder when no real user identity exists.
 *  Consumers can filter on this to distinguish real sessions from local ones. */
export const PSEUDO_USER_ID = 'pseudo_user_id';

// ── Span-derived nodes ────────────────────────────────────────────────────────

export interface InteractionNode extends SpannedNode {
  type: 'interaction';
  session_id: string;
  user_id: string;
  sequence: number;
  prompt: string;
}

export interface LlmRequestNode extends SpannedNode {
  type: 'llm_request';
  model: string;
  source?: string;
  request_messages?: RequestMessage[];
  response_messages?: ResponseMessage[];
  stop_reason?: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd?: number;
}

export interface ToolNode extends SpannedNode {
  type: 'tool';
  name?: string;
  /** The harness's tool-call id (Anthropic `tool_use.id`). The join key linking
   *  this tool to the inference that emitted it (via a `tool_use` block in the
   *  response) and the inference that consumed its result (via a `tool_result`
   *  block referencing this id). Absent when the trace doesn't carry one. */
  tool_use_id?: string;
  tool_input?: string;
}

export interface ToolExecutionNode extends SpannedNode {
  type: 'tool.execution';
}

export interface ToolBlockedOnUserNode extends SpannedNode {
  type: 'tool.blocked_on_user';
}

export interface HookNode extends SpannedNode {
  type: 'hook';
  name: string;
}

// ── Synthesized spine node (carries the interaction's prompt, no full span) ───

export interface UserPromptNode extends BaseNode {
  type: 'user_prompt';
  prompt: string;
}

// Canonical = the mechanical pipeline's output, the value type of the node-data
// table. No LLM is in this loop; every field is read or derived from the trace.
// Stays harness-agnostic.
export type CanonicalNode =
  | InteractionNode
  | LlmRequestNode
  | ToolNode
  | ToolExecutionNode
  | ToolBlockedOnUserNode
  | HookNode
  | UserPromptNode;

// ── Node-data layers — sparse, additive, all keyed by node id ──────────────────
// Each layer is its own id-keyed table (`node_deltas`, `node_semantics`) joined
// 1:1 to the node by id. A node "points to" its data through these tables — never
// an embedded object, so nothing re-duplicates on serialize/DB.

/** Stage 5 — the messages new to an `llm_request` relative to the previous request
 *  in the same thread. `requestMessagesDelta` is the suffix beyond the previous
 *  request (the first carries its full array); `responseMessagesDelta` is the full
 *  response (each response is all-new). Sparse: only `llm_request` nodes get a row. */
export interface MessageDeltas {
  readonly requestMessagesDelta?: readonly RequestMessage[];
  readonly responseMessagesDelta?: readonly ResponseMessage[];
}

/** Stage 6 — the semantic label for a relabeled node. `what` is an ordered list of
 *  atomic action phrases (a node often does several things in sequence — e.g.
 *  ["fetch ynet.co.il", "summarize headlines"]); a single-action node carries a
 *  one-element array. `comment` is an OPTIONAL agent-authored annotation harvested
 *  verbatim from a per-agent-configured input field (e.g. Claude Code's Bash
 *  `description`) — free text, a display signal only, never part of the closed
 *  `what` vocabulary. Sparse: only relabeled (`tool`/`llm_request`) nodes get a row.
 *  The presence of a row IS the "is this enriched?" flag — there is no node type. */
export interface SemanticFields {
  readonly what: readonly string[];
  readonly comment?: string;
}
