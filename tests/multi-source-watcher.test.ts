import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MultiSourceWatcher } from "../src/node/sources/multi-source-watcher.js";
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

function turnFromLine(source: "claude" | "codex", raw: string): ExtractedTurn[] {
  const entry = JSON.parse(raw) as { id: string; model?: string };
  return [
    {
      source,
      provider: source === "claude" ? "anthropic" : "openai",
      dedupKey: `${source}:${entry.id}`,
      msgId: entry.id,
      requestId: "",
      model: entry.model ?? (source === "claude" ? "claude-test" : "codex-test"),
      usage: {
        input_tokens: 1,
        output_tokens: source === "claude" ? 2 : 3,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      timestamp: "2026-05-12T00:00:00.000Z",
      sessionId: `${source}-session`,
      cwd: "",
    },
  ];
}

function makeJsonlSource(source: "claude" | "codex", dir: string, depth = 0): Source {
  return {
    id: source,
    provider: source === "claude" ? "anthropic" : "openai",
    access: "jsonl-tail",
    implemented: true,
    async isAvailable() {
      return true;
    },
    targets() {
      return [
        {
          kind: "jsonl-tail",
          dir,
          depth,
          match: (path: string) => path.endsWith(".jsonl"),
        },
      ];
    },
    createAdapter() {
      return {
        sourceId: source,
        ingestLine(raw: string) {
          return turnFromLine(source, raw);
        },
      };
    },
  };
}

describe("MultiSourceWatcher", () => {
  let root: string;
  let watcher: MultiSourceWatcher;
  let captured: ExtractedTurn[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "snf-multi-source-"));
    captured = [];
  });

  afterEach(async () => {
    await watcher?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it("tails all active jsonl sources through the Phase 2A watcher path", async () => {
    const claudeDir = join(root, "claude");
    const codexDir = join(root, "codex", "sessions", "2026", "05", "12");
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });

    const claudeFile = join(claudeDir, "session.jsonl");
    const codexFile = join(codexDir, "rollout-test.jsonl");
    writeFileSync(claudeFile, "");
    writeFileSync(codexFile, "");

    watcher = new MultiSourceWatcher(async () => [
      makeJsonlSource("claude", claudeDir),
      makeJsonlSource("codex", join(root, "codex"), 5),
    ]);
    watcher.onTurn((turn) => captured.push(turn));

    await watcher.start({ cwd: root, fromNow: true });
    expect(watcher.getActiveSourceIds()).toEqual(["claude", "codex"]);

    appendFileSync(claudeFile, JSON.stringify({ id: "claude-1" }) + "\n");
    appendFileSync(codexFile, JSON.stringify({ id: "codex-1" }) + "\n");

    await waitFor(() => expect(captured.map((turn) => turn.dedupKey).sort()).toEqual(["claude:claude-1", "codex:codex-1"]));
  });

  it("skips historical lines in from-now mode but emits appended lines", async () => {
    const sourceDir = join(root, "codex");
    mkdirSync(sourceDir, { recursive: true });
    const file = join(sourceDir, "rollout-test.jsonl");
    writeFileSync(file, JSON.stringify({ id: "old" }) + "\n");

    watcher = new MultiSourceWatcher(async () => [makeJsonlSource("codex", sourceDir)]);
    watcher.onTurn((turn) => captured.push(turn));

    await watcher.start({ cwd: root, fromNow: true });
    appendFileSync(file, JSON.stringify({ id: "new" }) + "\n");

    await waitFor(() => expect(captured.map((turn) => turn.dedupKey)).toEqual(["codex:new"]));
  });

  it("backfills existing lines when requested", async () => {
    const sourceDir = join(root, "claude");
    mkdirSync(sourceDir, { recursive: true });
    const file = join(sourceDir, "session.jsonl");
    writeFileSync(file, JSON.stringify({ id: "existing" }) + "\n");

    watcher = new MultiSourceWatcher(async () => [makeJsonlSource("claude", sourceDir)]);
    watcher.onTurn((turn) => captured.push(turn));

    await watcher.start({ cwd: root, fromNow: false });
    await waitFor(() => expect(captured.map((turn) => turn.dedupKey)).toEqual(["claude:existing"]));
  });
});
