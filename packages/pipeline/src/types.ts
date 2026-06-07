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
  | 'tool.blocked_on_user'
  | 'tool.execution'
  | 'hook';

export interface RequestMessage {
  role: string;
  content: unknown;
}

export interface ResponseMessage {
  type: string;
  [key: string]: unknown;
}

export interface CanonicalNode {
  id: string;
  type: NodeType;
  parent?: string;
  // Ambient identifiers — present on interaction nodes and synthesized aggregation nodes
  session_id?: string;
  user_id?: string;
  // Span timing — absent on synthesized nodes
  start_time_ns?: string;
  end_time_ns?: string;
  duration_ms?: number;
  name?: string;
  model?: string;
  source?: string;
  sequence?: number;
  prompt?: string;
  request_messages?: RequestMessage[];
  request?: string;
  response_messages?: ResponseMessage[];
  response?: string;
  stop_reason?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  tool_input?: string;
  tool_input_json?: string; // full JSON of the tool input object
}
