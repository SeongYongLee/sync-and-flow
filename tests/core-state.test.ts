import { describe, expect, it } from "vitest";
import { ensureCore, layoutCores, reconcileRoster, recordPlanetUse, type CoreState } from "../src/web/core-state.js";
import type { PeerMeta } from "../src/shared/protocol.js";

const viewport = { width: 800, height: 600 };

function peer(id: string): PeerMeta {
  return { id, nickname: id, color: "#80b4ff" };
}

describe("core state", () => {
  it("creates a new core at the viewport center", () => {
    const cores = new Map<string, CoreState>();
    const core = ensureCore(cores, peer("me"), viewport, () => 0);

    expect(core).toMatchObject({
      id: "me",
      x: 400,
      y: 300,
      tx: 400,
      ty: 300,
      pulse: 0,
      noisePhase: 0,
      ringAngles: [0, 0],
      dominantPlanetClass: "drift",
      secondaryPlanetClass: null,
      planetMix: { drift: 1 },
    });
  });

  it("centers a single viewer-only peer when there is no self core", () => {
    const cores = new Map<string, CoreState>();
    ensureCore(cores, peer("peer"), viewport, () => 0);

    layoutCores(cores, "me", viewport);

    expect(cores.get("peer")).toMatchObject({ tx: 400, ty: 300 });
  });

  it("keeps self centered and places peers on an orbit", () => {
    const cores = new Map<string, CoreState>();
    ensureCore(cores, peer("me"), viewport, () => 0);
    ensureCore(cores, peer("peer"), viewport, () => 0);

    layoutCores(cores, "me", viewport);

    expect(cores.get("me")).toMatchObject({ tx: 400, ty: 300 });
    expect(cores.get("peer")!.tx).toBeCloseTo(400);
    expect(cores.get("peer")!.ty).toBeCloseTo(132);
  });

  it("reconciles roster peers and removes stale cores", () => {
    const cores = new Map<string, CoreState>();
    ensureCore(cores, peer("me"), viewport, () => 0);
    ensureCore(cores, peer("old"), viewport, () => 0);

    reconcileRoster(cores, "me", [peer("new")], viewport);

    expect([...cores.keys()].sort()).toEqual(["me", "new"]);
  });

  it("tracks a bounded recent planet mix", () => {
    const cores = new Map<string, CoreState>();
    const state = ensureCore(cores, peer("me"), viewport, () => 0);

    recordPlanetUse(state, "forge", 70, 1);
    recordPlanetUse(state, "nebula", 30, 2);

    expect(state.dominantPlanetClass).toBe("forge");
    expect(state.secondaryPlanetClass).toBe("nebula");
    expect(state.planetMix.forge).toBeCloseTo(0.7);
    expect(state.planetMix.nebula).toBeCloseTo(0.3);
  });
});
