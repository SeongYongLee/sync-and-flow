import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { CodexAdapter, codexSource } from "../src/core/adapters/codex.js";
import type { ExtractedTurn } from "../src/core/types.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(__dir, "../fixtures", name), "utf-8").trim().split("\n");

function ingestFixture(name: string): ExtractedTurn[] {
  const adapter = new CodexAdapter();
  return fixture(name).flatMap((line) => adapter.ingestLine(line));
}

describe("CodexAdapter", () => {
  it("parses a single token_count turn", () => {
    const turns = ingestFixture("codex-single-turn.jsonl");
    expect(turns).toHaveLength(1);
    expect(turns[0]!.source).toBe("codex");
    expect(turns[0]!.provider).toBe("openai");
    expect(turns[0]!.sessionId).toBe("session-single");
    expect(turns[0]!.model).toBe("gpt-5-codex");
    expect(turns[0]!.dedupKey).toBe("codex:session-single:2026-05-07T00:00:01.000Z:110");
  });

  it("normalizes cached input out of input tokens", () => {
    const [turn] = ingestFixture("codex-cached-heavy.jsonl");
    expect(turn!.usage.input_tokens).toBe(100);
    expect(turn!.usage.cache_read_input_tokens).toBe(900);
  });

  it("adds reasoning output tokens to output tokens", () => {
    const [turn] = ingestFixture("codex-single-turn.jsonl");
    expect(turn!.usage.output_tokens).toBe(15);
  });

  it("skips duplicate cumulative totals", () => {
    const turns = ingestFixture("codex-cumulative-dup.jsonl");
    expect(turns).toHaveLength(1);
  });

  it("updates model from turn_context", () => {
    const turns = ingestFixture("codex-model-switch.jsonl");
    expect(turns.map((turn) => turn.model)).toEqual(["gpt-5-codex", "o4-mini"]);
  });

  it("seeds model context from an existing rollout without emitting old turns", () => {
    const adapter = new CodexAdapter();
    const [meta, firstTurn] = fixture("codex-single-turn.jsonl");
    adapter.seedFile("/tmp/rollout-test.jsonl", meta!);

    const turns = adapter.ingestLine(firstTurn!);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.model).toBe("gpt-5-codex");
  });

  it("declares a recursive rollout target", () => {
    const [target] = codexSource.targets({});
    expect(target?.kind).toBe("jsonl-tail");
    if (target?.kind !== "jsonl-tail") throw new Error("expected jsonl-tail target");
    expect(target.glob).toBe("sessions/**/rollout-*.jsonl");
    expect(target.match("/Users/me/.codex/sessions/2026/05/07/rollout-x.jsonl")).toBe(true);
  });
});
