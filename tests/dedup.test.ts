import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parseLine } from "../src/core/parse.js";
import { Deduplicator } from "../src/core/dedup.js";
import type { ExtractedTurn } from "../src/core/types.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(__dir, "../fixtures", name), "utf-8");

describe("Deduplicator", () => {
  it("accepts a turn only on first occurrence", () => {
    const dedup = new Deduplicator();
    const lines = fixture("duplicated-msg-id.jsonl").trim().split("\n");

    const turn1 = parseLine(lines[0]!);
    const turn2 = parseLine(lines[1]!);
    expect(turn1).not.toBeNull();
    expect(turn2).not.toBeNull();
    expect(turn1!.msgId).toBe(turn2!.msgId); // same msgId

    expect(dedup.accept(turn1!)).toBe(true);  // first → accept
    expect(dedup.accept(turn2!)).toBe(false); // duplicate → reject
  });

  it("accepts turns with distinct msgIds", () => {
    const dedup = new Deduplicator();
    const lines = fixture("two-models-mixed.jsonl").trim().split("\n");

    const turns = lines
      .map((l) => parseLine(l))
      .filter((t): t is NonNullable<typeof t> => t !== null);

    expect(turns).toHaveLength(2);
    expect(dedup.accept(turns[0]!)).toBe(true);
    expect(dedup.accept(turns[1]!)).toBe(true);
  });

  it("evicts oldest entry at LRU capacity", () => {
    const dedup = new Deduplicator();
    const base: ExtractedTurn = {
      source: "claude",
      provider: "anthropic",
      dedupKey: "claude:req",
      msgId: "",
      requestId: "req",
      model: "m",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      timestamp: "",
      sessionId: "",
      cwd: "",
    };

    // fill 1024 entries (msg_0 is the oldest)
    for (let i = 0; i < 1024; i++) {
      dedup.accept({ ...base, msgId: `msg_${i}`, dedupKey: `claude:msg_${i}` });
    }
    // msg_new triggers eviction of msg_0
    expect(dedup.accept({ ...base, msgId: "msg_new", dedupKey: "claude:msg_new" })).toBe(true);
    // msg_new is now in the set → duplicate
    expect(dedup.accept({ ...base, msgId: "msg_new", dedupKey: "claude:msg_new" })).toBe(false);
    // msg_0 was evicted, so it is accepted again as a new entry
    expect(dedup.accept({ ...base, msgId: "msg_0", dedupKey: "claude:msg_0" })).toBe(true);
  });

  it("resets state correctly", () => {
    const dedup = new Deduplicator();
    const turn: ExtractedTurn = {
      source: "claude",
      provider: "anthropic",
      dedupKey: "claude:msg_X",
      msgId: "msg_X",
      requestId: "",
      model: "m",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      timestamp: "",
      sessionId: "",
      cwd: "",
    };
    expect(dedup.accept(turn)).toBe(true);
    expect(dedup.accept(turn)).toBe(false);
    dedup.reset();
    expect(dedup.accept(turn)).toBe(true);
  });
});
