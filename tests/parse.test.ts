import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parseLine } from "../src/core/parse.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(__dir, "../fixtures", name), "utf-8");

describe("parseLine", () => {
  it("parses a valid assistant turn", () => {
    const lines = fixture("single-turn.jsonl").trim().split("\n");
    const turn = parseLine(lines[0]!);
    expect(turn).not.toBeNull();
    expect(turn!.source).toBe("claude");
    expect(turn!.provider).toBe("anthropic");
    expect(turn!.dedupKey).toBe("claude:msg_SINGLE001");
    expect(turn!.msgId).toBe("msg_SINGLE001");
    expect(turn!.model).toBe("claude-sonnet-4-6");
    expect(turn!.usage.input_tokens).toBe(100);
    expect(turn!.usage.output_tokens).toBe(50);
    expect(turn!.usage.cache_creation_input_tokens).toBe(500);
    expect(turn!.usage.cache_read_input_tokens).toBe(200);
  });

  it("ignores iterations — does NOT add them to top-level usage", () => {
    const lines = fixture("tool-use-thinking.jsonl").trim().split("\n");
    const turn = parseLine(lines[0]!);
    expect(turn).not.toBeNull();
    // iterations contains same numbers, but top-level usage is the canonical value
    expect(turn!.usage.input_tokens).toBe(200);
    expect(turn!.usage.output_tokens).toBe(80);
  });

  it("returns null for <synthetic> model", () => {
    const lines = fixture("synthetic-model.jsonl").trim().split("\n");
    const syntheticTurn = parseLine(lines[0]!);
    expect(syntheticTurn).toBeNull();
  });

  it("parses real (non-synthetic) entry", () => {
    const lines = fixture("synthetic-model.jsonl").trim().split("\n");
    const realTurn = parseLine(lines[1]!);
    expect(realTurn).not.toBeNull();
    expect(realTurn!.model).toBe("claude-sonnet-4-6");
  });

  it("returns null for truncated line", () => {
    const lines = fixture("truncated-line.jsonl").split("\n");
    // first line is complete
    expect(parseLine(lines[0]!)).not.toBeNull();
    // second line is truncated
    expect(parseLine(lines[1]!)).toBeNull();
  });

  it("returns null for non-assistant type lines", () => {
    const lines = fixture("two-models-mixed.jsonl").trim().split("\n");
    // third line is a user message
    expect(parseLine(lines[2]!)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("   ")).toBeNull();
  });
});
