import { describe, expect, it } from "vitest";
import { applySnapshotEvent, applyTurnEvent } from "../src/web/turn-events.js";
import type { CoreState } from "../src/web/core-state.js";
import type { TurnEvent, SnapshotEvent } from "../src/web/stream-client.js";

function core(id: string): CoreState {
  return {
    id,
    nickname: id,
    color: "#80b4ff",
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    energy: 0,
    targetEnergy: 0,
    pulse: 0,
    lastTurnAt: 0,
    noisePhase: 0,
    ringAngles: [0, 0],
    lastSource: "",
    lastModel: "",
    planetHistory: [],
    planetMix: { drift: 1 },
    dominantPlanetClass: "drift",
    secondaryPlanetClass: null,
    auraScale: 1,
    growthScale: 1,
    resourceBoost: 1,
  };
}

const turn: TurnEvent = {
  type: "turn",
  source: "codex",
  provider: "openai",
  model: "gpt-5-codex",
  delta: { inputTokens: 1, outputTokens: 61, cacheReadTokens: 0 },
  totals: { inputTokens: 1, outputTokens: 61, cacheReadTokens: 0, turns: 3, totalUsd: 0 },
  energy: 99,
  timestamp: "2026-05-16T00:00:00.000Z",
};

const snapshot: SnapshotEvent = {
  type: "snapshot",
  source: "claude",
  model: "claude-sonnet-4-6",
  totals: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, turns: 2, totalUsd: 0 },
  energy: 20.5,
};

describe("turn event application", () => {
  it("updates core state, spawns particles, and updates HUD for self turns", () => {
    const cores = new Map([["me", core("me")]]);
    const particles = {
      calls: [] as unknown[][],
      spawn(...args: unknown[]) {
        this.calls.push(args);
      },
    };
    const hud = {
      calls: [] as unknown[][],
      updateTurn(...args: unknown[]) {
        this.calls.push(args);
      },
    };

    const applied = applyTurnEvent("me", turn, {
      cores,
      particles,
      hud,
      selfId: "me",
      viewport: { width: 800, height: 600 },
      now: () => 1234,
    });

    expect(applied).toBe(true);
    expect(cores.get("me")).toMatchObject({
      targetEnergy: 106.92,
      lastTurnAt: 1234,
      lastSource: "codex",
      lastModel: "gpt-5-codex",
      dominantPlanetClass: "forge",
    });
    expect(particles.calls[0]?.[1]).toBe(13);
    expect(particles.calls[0]?.[3]).toEqual({ width: 800, height: 600 });
    expect(particles.calls[0]?.[4]).toBe(true);
    expect(particles.calls[0]?.[5]).toMatchObject({ speed: 1.18, spread: 0.82, life: 0.9, pull: 1.06 });
    expect(hud.calls).toEqual([["codex", "gpt-5-codex", 3, 61, 106.92, "forge", "Forge 100%"]]);
  });

  it("does not update HUD for peer turns", () => {
    const cores = new Map([["peer", core("peer")]]);
    const particles = { spawn() {} };
    const hud = {
      calls: 0,
      updateTurn() {
        this.calls += 1;
      },
    };

    expect(applyTurnEvent("peer", turn, { cores, particles, hud, selfId: "me", viewport: { width: 800, height: 600 } })).toBe(true);
    expect(hud.calls).toBe(0);
  });

  it("updates HUD for peer turns when the caller is a viewer-only display", () => {
    const cores = new Map([["peer", core("peer")]]);
    const particles = { spawn() {} };
    const hud = {
      calls: [] as unknown[][],
      updateTurn(...args: unknown[]) {
        this.calls.push(args);
      },
    };

    expect(
      applyTurnEvent("peer", turn, {
        cores,
        particles,
        hud,
        selfId: "viewer",
        viewport: { width: 800, height: 600 },
        shouldUpdateHud: () => true,
      }),
    ).toBe(true);
    expect(hud.calls).toEqual([["codex", "gpt-5-codex", 3, 61, 106.92, "forge", "Forge 100%"]]);
  });

  it("applies snapshots without spawning particles", () => {
    const cores = new Map([["me", core("me")]]);
    const hud = {
      calls: [] as unknown[][],
      updateTurn(...args: unknown[]) {
        this.calls.push(args);
      },
    };

    expect(applySnapshotEvent("me", snapshot, { cores, hud, selfId: "me", viewport: { width: 800, height: 600 }, now: () => 5678 })).toBe(true);
    expect(cores.get("me")).toMatchObject({
      targetEnergy: 20.5,
      lastTurnAt: 5678,
      lastSource: "claude",
      lastModel: "claude-sonnet-4-6",
      dominantPlanetClass: "nebula",
    });
    expect(hud.calls).toEqual([["claude", "claude-sonnet-4-6", 2, 20, 20.5, "nebula", "Nebula 100%"]]);
  });

  it("returns false when the owner core is missing", () => {
    const hud = { updateTurn() {} };
    const particles = { spawn() {} };

    expect(applyTurnEvent("missing", turn, { cores: new Map(), particles, hud, selfId: "me", viewport: { width: 800, height: 600 } })).toBe(false);
    expect(applySnapshotEvent("missing", snapshot, { cores: new Map(), hud, selfId: "me", viewport: { width: 800, height: 600 } })).toBe(false);
  });
});
