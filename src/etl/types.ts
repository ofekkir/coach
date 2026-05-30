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
  | 'interaction'
  | 'llm_request'
  | 'tool'
  | 'tool.blocked_on_user'
  | 'tool.execution'
  | 'hook';

export interface TraceNode {
  id: string;
  type: NodeType;
  parent?: string;
  start_time_ns?: string;
  end_time_ns?: string;
  duration_ms?: number;
  name?: string;
  model?: string;
  source?: string;
  prompt?: string;
  raw_request?: string;
  request?: string;
  raw_response?: string;
  response?: string;
  stop_reason?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  tool_input?: string;
}
