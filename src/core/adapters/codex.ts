import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtractedTurn, Usage } from "../types.js";
import type { Source, SourceAdapter, SourceTarget } from "./types.js";

export const codexSource: Source = {
  id: "codex",
  provider: "openai",
  access: "jsonl-tail",
  implemented: true,
  async isAvailable(): Promise<boolean> {
    return existsSync(codexHome());
  },
  targets(): SourceTarget[] {
    return [
      {
        kind: "jsonl-tail",
        dir: codexHome(),
        glob: "sessions/**/rollout-*.jsonl",
        depth: 5,
        match: (path) => /(^|\/)sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-.*\.jsonl$/.test(path),
      },
    ];
  },
  createAdapter(): SourceAdapter {
    return new CodexAdapter();
  },
};

export class CodexAdapter implements SourceAdapter {
  readonly sourceId = "codex" as const;
  private currentModel: string | null = null;
  private currentSessionId: string | null = null;
  private lastCumulativeBySession = new Map<string, number>();

  seedFile(_path: string, content: string): void {
    for (const line of content.split(/\r?\n/)) {
      this.seedLine(line);
    }
  }

  ingestLine(raw: string): ExtractedTurn[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      return [];
    }

    if (!isObject(entry)) return [];

    const timestamp = typeof entry["timestamp"] === "string" ? entry["timestamp"] : "";
    const type = entry["type"];
    const payload = entry["payload"];

    if (type === "session_meta" && isObject(payload)) {
      this.currentSessionId = stringField(payload, "id") ?? stringField(payload, "session_id") ?? this.currentSessionId;
      this.currentModel = stringField(payload, "model") ?? this.currentModel;
      return [];
    }

    if (type === "turn_context" && isObject(payload)) {
      this.currentModel = stringField(payload, "model") ?? this.currentModel;
      return [];
    }

    if (type !== "event_msg" || !isObject(payload) || payload["type"] !== "token_count") {
      return [];
    }

    const info = payload["info"];
    if (!isObject(info)) return [];

    const lastUsage = extractTokenUsage(info["last_token_usage"]);
    if (!lastUsage) return [];

    const cumulative = extractTokenUsage(info["total_token_usage"]);
    const cumulativeTotal = cumulative?.total_tokens ?? lastUsage.total_tokens;
    const sessionId = this.currentSessionId ?? "unknown";

    if (this.lastCumulativeBySession.get(sessionId) === cumulativeTotal) {
      return [];
    }
    this.lastCumulativeBySession.set(sessionId, cumulativeTotal);

    const inputTokens = Math.max(0, lastUsage.input_tokens - lastUsage.cached_input_tokens);
    const usage: Usage = {
      input_tokens: inputTokens,
      output_tokens: lastUsage.output_tokens + lastUsage.reasoning_output_tokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: lastUsage.cached_input_tokens,
    };

    const dedupKey = `codex:${sessionId}:${timestamp}:${cumulativeTotal}`;

    return [
      {
        source: "codex",
        provider: "openai",
        dedupKey,
        msgId: dedupKey,
        requestId: "",
        model: this.currentModel ?? "unknown",
        usage,
        timestamp,
        sessionId,
        cwd: "",
        meta: {
          cumulativeTotal,
          rawLastTokenUsage: lastUsage,
        },
      },
    ];
  }

  private seedLine(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) return;

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (!isObject(entry)) return;
    const type = entry["type"];
    const payload = entry["payload"];

    if (type === "session_meta" && isObject(payload)) {
      this.currentSessionId = stringField(payload, "id") ?? stringField(payload, "session_id") ?? this.currentSessionId;
      this.currentModel = stringField(payload, "model") ?? this.currentModel;
      return;
    }

    if (type === "turn_context" && isObject(payload)) {
      this.currentModel = stringField(payload, "model") ?? this.currentModel;
      return;
    }

    if (type !== "event_msg" || !isObject(payload) || payload["type"] !== "token_count") return;
    const info = payload["info"];
    if (!isObject(info)) return;

    const cumulative = extractTokenUsage(info["total_token_usage"]);
    if (!cumulative) return;
    const sessionId = this.currentSessionId ?? "unknown";
    this.lastCumulativeBySession.set(sessionId, cumulative.total_tokens);
  }
}

interface CodexTokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

function codexHome(): string {
  return process.env["CODEX_HOME"] ?? join(process.env["HOME"] ?? "", ".codex");
}

function extractTokenUsage(raw: unknown): CodexTokenUsage | null {
  if (!isObject(raw)) return null;

  const input_tokens = toNumber(raw["input_tokens"]);
  const cached_input_tokens = toNumber(raw["cached_input_tokens"]) ?? 0;
  const output_tokens = toNumber(raw["output_tokens"]);
  const reasoning_output_tokens = toNumber(raw["reasoning_output_tokens"]) ?? 0;
  const total_tokens = toNumber(raw["total_tokens"]);

  if (input_tokens === null || output_tokens === null || total_tokens === null) {
    return null;
  }

  return {
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_output_tokens,
    total_tokens,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" ? value : null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  return null;
}
