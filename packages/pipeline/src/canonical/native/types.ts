export interface ContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly thinking?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly tool_use_id?: string;
  readonly content?: unknown;
}

interface NativeMessage {
  readonly id?: string;
  readonly model?: string;
  readonly content?: string | readonly ContentBlock[];
  readonly stop_reason?: string;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
}

export interface NativeEntry {
  readonly uuid?: string;
  readonly parentUuid?: string | null;
  readonly type?: string;
  readonly subtype?: string;
  readonly timestamp?: string;
  readonly sessionId?: string;
  readonly isMeta?: boolean;
  readonly message?: NativeMessage;
  readonly requestId?: string;
  readonly cwd?: string;
  readonly gitBranch?: string;
}

export interface LlmSpanMeta {
  model: string;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  spanStart: string;
  spanEnd: string;
}
