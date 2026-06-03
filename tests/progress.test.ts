import { afterEach, describe, expect, it } from "vitest";
import { ensureCore } from "../src/web/core-state.js";
import { clearProgress, formatProgressSummary, loadProgress, progressToSnapshot, saveTurnProgress } from "../src/web/progress.js";
import type { TurnEvent } from "../src/web/stream-client.js";

const originalLocalStorage = globalThis.localStorage;

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function installStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
});

describe("progress storage", () => {
  it("saves local turn totals and restores them as a snapshot", () => {
    installStorage();
    const core = ensureCore(new Map(), { id: "me", nickname: "me", color: "#80b4ff" }, { width: 800, height: 600 }, () => 0.5);
    const event: TurnEvent = {
      type: "turn",
      source: "codex",
      provider: "openai",
      model: "gpt-5.5",
      delta: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 3 },
      totals: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 30, turns: 4, totalUsd: 0 },
      energy: 203,
      timestamp: "2026-06-03T00:00:00.000Z",
    };

    const saved = saveTurnProgress("me", event, core, () => new Date("2026-06-03T01:00:00.000Z"));
    const loaded = loadProgress("me");

    expect(saved).toBeTruthy();
    expect(loaded?.totals.outputTokens).toBe(200);
    expect(loaded?.sourceTotals["codex:openai:gpt-5.5"]?.turns).toBe(4);
    expect(progressToSnapshot(loaded!).totals).toEqual(event.totals);
    expect(formatProgressSummary(loaded).model).toBe("codex:gpt-5.5");
    expect(formatProgressSummary(loaded).turns).toBe("4");

    clearProgress("me");
    expect(loadProgress("me")).toBeNull();
  });

  it("ignores malformed progress records", () => {
    installStorage();
    localStorage.setItem("sf:progress:v1:me", JSON.stringify({ version: 1, userId: "me", totals: { turns: "bad" } }));

    expect(loadProgress("me")).toBeNull();
  });
});
