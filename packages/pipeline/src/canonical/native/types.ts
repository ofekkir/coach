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
  readonly model?: string;
  readonly content?: string | readonly ContentBlock[];
  readonly stop_reason?: string;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
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
}

export interface LlmSpanMeta {
  model: string;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  spanStart: string;
  spanEnd: string;
}
