import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlTailDriver } from "../src/node/sources/jsonl-tail.js";
import type { Source } from "../src/core/adapters/types.js";
import type { ExtractedTurn } from "../src/core/types.js";

async function waitFor(assertion: () => void | boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start < timeoutMs) {
    try {
      const result = assertion();
      if (result !== false) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  if (lastError) throw lastError;
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

function makeSource(): Source {
  return {
    id: "codex",
    provider: "openai",
    access: "jsonl-tail",
    implemented: true,
    async isAvailable() {
      return true;
    },
    targets() {
      return [];
    },
    createAdapter() {
      return {
        sourceId: "codex",
        ingestLine(raw: string) {
          const entry = JSON.parse(raw) as { id: string };
          return [
            {
              source: "codex",
              provider: "openai",
              dedupKey: `codex:${entry.id}`,
              msgId: entry.id,
              requestId: "",
              model: "gpt-test",
              usage: {
                input_tokens: 1,
                output_tokens: 2,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
              timestamp: "2026-05-07T00:00:00.000Z",
              sessionId: "session-test",
              cwd: "",
            },
          ] satisfies ExtractedTurn[];
        },
      };
    },
  };
}

function makeSeededSource(): Source {
  return {
    id: "codex",
    provider: "openai",
    access: "jsonl-tail",
    implemented: true,
    async isAvailable() {
      return true;
    },
    targets() {
      return [];
    },
    createAdapter() {
      let model = "unknown";
      return {
        sourceId: "codex",
        seedFile(_path: string, content: string) {
          const entry = JSON.parse(content.trim()) as { model: string };
          model = entry.model;
        },
        ingestLine(raw: string) {
          const entry = JSON.parse(raw) as { id: string };
          return [
            {
              source: "codex",
              provider: "openai",
              dedupKey: `codex:${entry.id}`,
              msgId: entry.id,
              requestId: "",
              model,
              usage: {
                input_tokens: 1,
                output_tokens: 2,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
              timestamp: "2026-05-07T00:00:00.000Z",
              sessionId: "session-test",
              cwd: "",
            },
          ] satisfies ExtractedTurn[];
        },
      };
    },
  };
}

describe("JsonlTailDriver", () => {
  let dir: string;
  let driver: JsonlTailDriver;
  let captured: ExtractedTurn[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "snf-jsonl-tail-"));
    captured = [];
    driver = new JsonlTailDriver(
      makeSource(),
      {
        kind: "jsonl-tail",
        dir,
        depth: 2,
        match: (path) => path.endsWith(".jsonl"),
      },
      true,
    );
  });

  afterEach(async () => {
    await driver.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("tails matching jsonl files recursively from the current file size", async () => {
    const nested = join(dir, "sessions", "2026");
    mkdirSync(nested, { recursive: true });
    const file = join(nested, "rollout-test.jsonl");

    writeFileSync(file, JSON.stringify({ id: "skipped" }) + "\n");
    await driver.start((turn) => captured.push(turn));

    appendFileSync(file, JSON.stringify({ id: "captured" }) + "\n");

    await waitFor(() => expect(captured.map((turn) => turn.dedupKey)).toEqual(["codex:captured"]));
  });

  it("seeds adapter state from existing content while starting from the current file size", async () => {
    await driver.stop();
    driver = new JsonlTailDriver(
      makeSeededSource(),
      {
        kind: "jsonl-tail",
        dir,
        depth: 2,
        match: (path) => path.endsWith(".jsonl"),
      },
      true,
    );

    const nested = join(dir, "sessions", "2026");
    mkdirSync(nested, { recursive: true });
    const file = join(nested, "rollout-test.jsonl");

    writeFileSync(file, JSON.stringify({ model: "gpt-seeded" }) + "\n");
    await driver.start((turn) => captured.push(turn));

    appendFileSync(file, JSON.stringify({ id: "captured" }) + "\n");

    await waitFor(() => expect(captured.map((turn) => turn.model)).toEqual(["gpt-seeded"]));
  });

  it("backfills existing content when fromNow is false", async () => {
    await driver.stop();
    driver = new JsonlTailDriver(
      makeSource(),
      {
        kind: "jsonl-tail",
        dir,
        depth: 2,
        match: (path) => path.endsWith(".jsonl"),
      },
      false,
    );

    const nested = join(dir, "sessions", "2026");
    mkdirSync(nested, { recursive: true });
    const file = join(nested, "rollout-test.jsonl");

    writeFileSync(file, JSON.stringify({ id: "existing" }) + "\n");
    await driver.start((turn) => captured.push(turn));

    await waitFor(() => expect(captured.map((turn) => turn.dedupKey)).toEqual(["codex:existing"]));
  });
});
