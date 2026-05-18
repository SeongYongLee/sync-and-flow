export type Provider = "anthropic" | "openai" | "google" | "github";

export type SourceId =
  | "claude"
  | "codex"
  | "cursor-agent"
  | "gemini-cli"
  | "antigravity"
  | "cursor"
  | "claude-desktop"
  | "copilot";

export interface CacheCreation {
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation?: CacheCreation;
}

export interface ExtractedTurn {
  source: SourceId;
  provider: Provider;
  dedupKey: string;
  msgId: string;
  requestId: string;
  model: string;
  usage: Usage;
  timestamp: string;
  sessionId: string;
  cwd: string;
  meta?: Record<string, unknown>;
}

export interface RunningTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turns: number;
  totalUsd: number;
}

export interface TurnCost {
  inputUsd: number;
  outputUsd: number;
  cacheCreate5mUsd: number;
  cacheCreate1hUsd: number;
  cacheReadUsd: number;
  totalUsd: number;
}
