import { basename } from "node:path";
import type { ExtractedTurn, Usage } from "../types.js";
import type { Source, SourceAdapter, SourceTarget } from "./types.js";

const UUID_SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

function isClaudeSessionFile(path: string): boolean {
  return UUID_SESSION_RE.test(basename(path));
}

export const claudeSource: Source = {
  id: "claude",
  provider: "anthropic",
  access: "jsonl-tail",
  implemented: true,
  async isAvailable(): Promise<boolean> {
    return false;
  },
  targets(opts: { cwd?: string }): SourceTarget[] {
    const cwd = opts.cwd ?? process.cwd();
    return [
      {
        kind: "jsonl-tail",
        dir: cwd,
        depth: 0,
        match: isClaudeSessionFile,
      },
    ];
  },
  createAdapter(): SourceAdapter {
    return new ClaudeAdapter();
  },
};

export class ClaudeAdapter implements SourceAdapter {
  readonly sourceId = "claude" as const;

  ingestLine(raw: string): ExtractedTurn[] {
    const turn = parseClaudeLine(raw);
    return turn ? [turn] : [];
  }
}

export function parseClaudeLine(raw: string): ExtractedTurn | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let entry: unknown;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isObject(entry)) return null;
  if (entry["type"] !== "assistant") return null;

  const msg = entry["message"];
  if (!isObject(msg)) return null;
  if (msg["role"] !== "assistant") return null;

  const model = msg["model"];
  if (typeof model !== "string") return null;

  if (model === "<synthetic>") return null;

  const rawUsage = msg["usage"];
  if (!isObject(rawUsage)) return null;

  const usage = extractUsage(rawUsage);
  if (!usage) return null;

  const msgId = typeof msg["id"] === "string" ? msg["id"] : "";
  const requestId = typeof entry["requestId"] === "string" ? entry["requestId"] : "";
  const timestamp = typeof entry["timestamp"] === "string" ? entry["timestamp"] : "";
  const sessionId = typeof entry["sessionId"] === "string" ? entry["sessionId"] : "";
  const cwd = typeof entry["cwd"] === "string" ? entry["cwd"] : "";
  const dedupKey = msgId ? `claude:${msgId}` : `claude:req:${requestId}`;

  return {
    source: "claude",
    provider: "anthropic",
    dedupKey,
    msgId,
    requestId,
    model,
    usage,
    timestamp,
    sessionId,
    cwd,
  };
}

function extractUsage(raw: Record<string, unknown>): Usage | null {
  const input_tokens = toNumber(raw["input_tokens"]);
  const output_tokens = toNumber(raw["output_tokens"]);
  const cache_creation_input_tokens = toNumber(raw["cache_creation_input_tokens"]);
  const cache_read_input_tokens = toNumber(raw["cache_read_input_tokens"]);

  if (
    input_tokens === null ||
    output_tokens === null ||
    cache_creation_input_tokens === null ||
    cache_read_input_tokens === null
  ) {
    return null;
  }

  const cc = raw["cache_creation"];
  const cache_creation = isObject(cc)
    ? {
        ephemeral_5m_input_tokens: toNumber(cc["ephemeral_5m_input_tokens"]) ?? 0,
        ephemeral_1h_input_tokens: toNumber(cc["ephemeral_1h_input_tokens"]) ?? 0,
      }
    : undefined;

  const result: Usage = {
    input_tokens,
    output_tokens,
    cache_creation_input_tokens,
    cache_read_input_tokens,
  };
  if (cache_creation !== undefined) result.cache_creation = cache_creation;
  return result;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  return null;
}
