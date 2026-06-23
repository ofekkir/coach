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
  // `string | undefined` (not exact-optional) so the aggregate builder can assign
  // `node.cwd` straight through under `exactOptionalPropertyTypes`.
  readonly cwd?: string | undefined; // working directory the session ran in (native only)
  readonly branch?: string | undefined; // git branch the session ran on (native only)
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
  cwd?: string; // working directory; native only (carried up to the Session entity)
  branch?: string; // git branch; native only (carried up to the Session entity)
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

/** The closed, deterministic taxonomy for a failed tool call, classified from the
 *  tool_result text/exit info by rule (no LLM). NULL/absent when the call succeeded
 *  or has no matched result. See `graph/result/result.ts` for the classifier rules. */
export type ErrorKind =
  | 'not_found' // file/path/command not found
  | 'invalid_args' // bad arguments / parse failure / a "no match" edit
  | 'permission' // permission denied
  | 'timeout' // timed out
  | 'nonzero_exit' // a Bash non-zero exit not otherwise classified
  | 'other'; // an error that matched none of the above

export interface ToolNode extends SpannedNode {
  type: 'tool';
  name?: string;
  /** The harness's tool-call id (Anthropic `tool_use.id`). The join key linking
   *  this tool to the inference that emitted it (via a `tool_use` block in the
   *  response) and the inference that consumed its result (via a `tool_result`
   *  block referencing this id). Absent when the trace doesn't carry one. */
  tool_use_id?: string;
  tool_input?: string;
  /** Tool outcome, attached at canonical construction (`canonical/result/result.ts`)
   *  from the `tool_result` block matched by `tool_use_id` in the consuming
   *  inference's `request_messages`. `is_error` is the harness's failure flag
   *  (absent when no result was matched — those stay NULL, queryable as such).
   *  `error_kind` is the deterministic classification of a failure (absent when ok).
   *  `output_size` is the character length of the result content (any outcome).
   *  `error_message` is a ≤500-char summary of the error text — set only on failures
   *  (a successful call's content is not stored, only its size). */
  is_error?: boolean;
  error_kind?: ErrorKind;
  output_size?: number;
  error_message?: string;
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

// Canonical = the mechanical pipeline's output, the value type of the node-data
// table. No LLM is in this loop; every field is read or derived from the trace.
// Stays harness-agnostic. The interaction's prompt is `InteractionNode.prompt` —
// there is no separate prompt node; the renderer derives the spine-head anchor
// from that field, the way it derives the agent/session cards from entities.
export type CanonicalNode =
  | InteractionNode
  | LlmRequestNode
  | ToolNode
  | ToolExecutionNode
  | ToolBlockedOnUserNode
  | HookNode;

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
/** Structured, machine-readable context for a relabeled node — the data the `what`
 *  phrase used to flatten into a parenthetical (`(package=pipeline)`) or fold into a
 *  basename. Promoted out of the phrase so a consumer can read the package/file/url
 *  as data. All fields optional; the whole object is absent when nothing applies.
 *  `package`: the workspace deduced from the path (e.g. `pipeline`). `file`: the
 *  repo-relative file path (worktree-normalized, same basis as `repo_path`). `url`:
 *  the target URL for web/fetch tools. */
export interface SemanticContext {
  readonly package?: string;
  readonly file?: string;
  readonly url?: string;
}

export interface SemanticFields {
  readonly what: readonly string[];
  readonly comment?: string;
  readonly context?: SemanticContext;
}
