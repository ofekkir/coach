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

// ── Transformed node (ETL output) ────────────────────────────────────────────

export type NodeType =
  | 'agent'
  | 'session'
  | 'interaction'
  | 'user_prompt'
  | 'llm_request'
  | 'tool'
  | 'tool.execution'
  | 'tool.blocked_on_user'
  | 'hook'
  | 'action' // enriched: tool → semantically-labeled action
  | 'inference'; // enriched: llm_request → semantically-labeled inference

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
 *  narrowing first. */
interface BaseNode {
  id: string;
  type: NodeType;
  parent?: string;
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

// ── Synthesized aggregation nodes (no span, no timing) ────────────────────────

export interface AgentNode extends BaseNode {
  type: 'agent';
  user_id: string;
}

export interface SessionNode extends BaseNode {
  type: 'session';
  session_id: string;
  user_id: string;
}

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

// Canonical = the mechanical pipeline's output. No LLM is in this loop; every
// field is read or derived from the trace. Stays harness-agnostic.
export type CanonicalNode =
  | AgentNode
  | SessionNode
  | InteractionNode
  | LlmRequestNode
  | ToolNode
  | ToolExecutionNode
  | ToolBlockedOnUserNode
  | HookNode
  | UserPromptNode;

// ── Semantic nodes — produced by the semantic stage, NOT canonical ────────────
// A canonical step relabeled by an LLM: a `tool` becomes an `action`, an
// `llm_request` becomes an `inference`, each carrying a generated `what`. `what`
// is an ordered list of atomic action phrases (a node often does several things
// in sequence — e.g. ["fetch ynet.co.il", "summarize headlines"]); a single-
// action node carries a one-element array. These only exist after enrichment, so
// they are a distinct type from CanonicalNode.
//
// `comment` is an OPTIONAL agent-authored annotation harvested verbatim from a
// per-agent-configured input field (e.g. Claude Code's Bash `description`). It is
// free text — a display/explanation signal only, never part of the closed `what`
// vocabulary, so it is kept separate and never feeds aggregation. The gap between
// the agent's stated `comment` and the derived `what` is itself a coach signal.

export type InferenceNode = Omit<LlmRequestNode, 'type'> & {
  type: 'inference';
  what: readonly string[];
  comment?: string;
};

export type ActionNode = Omit<ToolNode, 'type'> & {
  type: 'action';
  what: readonly string[];
  comment?: string;
};

export type SemanticNode = ActionNode | InferenceNode;

// What an execution-graph step carries: a mechanical node, or — once the
// semantic stage has run — its relabeled counterpart.
export type GraphNode = CanonicalNode | SemanticNode;
