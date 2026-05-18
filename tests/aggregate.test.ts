import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parseLine } from "../src/core/parse.js";
import { Aggregator } from "../src/core/aggregate.js";
import type { ExtractedTurn } from "../src/core/types.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(__dir, "../fixtures", name), "utf-8");

function ingestFile(aggregator: Aggregator, name: string) {
  const lines = fixture(name).split("\n");
  for (const line of lines) {
    const turn = parseLine(line);
    if (turn) aggregator.ingest(turn);
  }
}

function makeTurn(overrides: Partial<ExtractedTurn>): ExtractedTurn {
  return {
    source: "claude",
    provider: "anthropic",
    dedupKey: "claude:default",
    msgId: "default",
    requestId: "",
    model: "claude-sonnet-4-6",
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 5,
    },
    timestamp: "2026-05-07T00:00:00.000Z",
    sessionId: "session-test",
    cwd: "/test",
    ...overrides,
  };
}

describe("Aggregator", () => {
  it("deduplicates turns with same msgId", () => {
    const agg = new Aggregator();
    ingestFile(agg, "duplicated-msg-id.jsonl");
    const snapshot = agg.getSnapshot();
    const totals = snapshot.get("claude:claude-sonnet-4-6");
    expect(totals).toBeDefined();
    expect(totals!.turns).toBe(1); // only 1 unique turn despite 2 lines
    expect(totals!.outputTokens).toBe(30);
  });

  it("tracks per-model totals separately", () => {
    const agg = new Aggregator();
    ingestFile(agg, "two-models-mixed.jsonl");
    const snapshot = agg.getSnapshot();
    expect(snapshot.size).toBe(2);
    expect(snapshot.has("claude:claude-sonnet-4-6")).toBe(true);
    expect(snapshot.has("claude:claude-opus-4-7")).toBe(true);
    expect(snapshot.get("claude:claude-sonnet-4-6")!.turns).toBe(1);
    expect(snapshot.get("claude:claude-opus-4-7")!.turns).toBe(1);
  });

  it("calls onTurn handler once per unique turn", () => {
    const agg = new Aggregator();
    const handler = vi.fn();
    agg.onTurn(handler);
    ingestFile(agg, "duplicated-msg-id.jsonl");
    expect(handler).toHaveBeenCalledTimes(1); // deduplicated
  });

  it("accumulates totals across multiple turns", () => {
    const agg = new Aggregator();
    ingestFile(agg, "two-models-mixed.jsonl");
    const sonnet = agg.getSnapshot().get("claude:claude-sonnet-4-6")!;
    expect(sonnet.inputTokens).toBe(100);
    expect(sonnet.outputTokens).toBe(40);
    expect(sonnet.totalUsd).toBeGreaterThan(0);
  });

  it("skips synthetic model entries", () => {
    const agg = new Aggregator();
    ingestFile(agg, "synthetic-model.jsonl");
    const snapshot = agg.getSnapshot();
    // only the real entry should be counted
    expect(snapshot.has("claude:<synthetic>")).toBe(false);
    expect(snapshot.has("claude:claude-sonnet-4-6")).toBe(true);
    expect(snapshot.get("claude:claude-sonnet-4-6")!.turns).toBe(1);
  });

  it("keeps per-source totals while exposing combined local totals", () => {
    const agg = new Aggregator();
    const claude = makeTurn({ dedupKey: "claude:msg-1", msgId: "msg-1" });
    const codex = makeTurn({
      source: "codex",
      provider: "openai",
      dedupKey: "codex:session-1:100",
      msgId: "codex:session-1:100",
      model: "gpt-5-codex",
      usage: {
        input_tokens: 7,
        output_tokens: 11,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 13,
      },
    });

    expect(agg.ingest(claude)).toBe(true);
    expect(agg.ingest(codex)).toBe(true);

    const snapshot = agg.getSnapshot();
    expect(snapshot.get("claude:claude-sonnet-4-6")!.outputTokens).toBe(20);
    expect(snapshot.get("codex:gpt-5-codex")!.outputTokens).toBe(11);

    const combined = agg.getCombinedTotals();
    expect(combined.turns).toBe(2);
    expect(combined.inputTokens).toBe(17);
    expect(combined.outputTokens).toBe(31);
    expect(combined.cacheReadTokens).toBe(18);
  });
});
