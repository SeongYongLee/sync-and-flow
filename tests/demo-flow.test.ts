import { describe, expect, it } from "vitest";
import { DEMO_CORE_ID, createDemoFlowState, ensureDemoFlowCore, nextDemoTurn, removeDemoFlowCore, shouldShowDemoFlow } from "../src/web/demo-flow.js";
import type { CoreState } from "../src/web/core-state.js";

describe("demo flow", () => {
  it("shows only in browser-only mode before real cores arrive", () => {
    expect(shouldShowDemoFlow("browser-only", new Map())).toBe(true);
    expect(shouldShowDemoFlow("local-bridge", new Map())).toBe(false);
    expect(shouldShowDemoFlow("browser-only", new Map([["real", core("real")]]))).toBe(false);
    expect(shouldShowDemoFlow("browser-only", new Map([[DEMO_CORE_ID, core(DEMO_CORE_ID)]]))).toBe(true);
  });

  it("creates a centered demo core without faking a fixed model state", () => {
    const cores = new Map<string, CoreState>();
    const demo = ensureDemoFlowCore(cores, { width: 800, height: 600 });

    expect(demo.id).toBe(DEMO_CORE_ID);
    expect(demo.tx).toBe(400);
    expect(demo.ty).toBe(300);
    expect(demo.lastModel).toBe("");
    expect(cores.get(DEMO_CORE_ID)).toBe(demo);
  });

  it("generates accumulating demo turns across model families", () => {
    const state = createDemoFlowState(0);
    const randomValues = [0.95, 0.8, 0.4, 0.5, 0.2, 0.8, 0.9, 0.35, 0.7, 0.6, 0.2];
    let randomIndex = 0;
    const random = () => randomValues[randomIndex++ % randomValues.length]!;

    const initialWait = nextDemoTurn(state, 0, random);
    const firstTurnAt = state.nextTurnAt;
    const first = nextDemoTurn(state, firstTurnAt, random)!;
    const firstNextTurnAt = state.nextTurnAt;
    const waiting = nextDemoTurn(state, firstTurnAt + 10, random);
    const second = nextDemoTurn(state, state.nextTurnAt, random)!;

    expect(initialWait).toBeNull();
    expect(first).not.toBeNull();
    expect(waiting).toBeNull();
    expect(firstNextTurnAt).toBeGreaterThanOrEqual(3_300);
    expect(second.totals.turns).toBe(2);
    expect(second.totals.outputTokens).toBeGreaterThan(first.totals.outputTokens);
    expect(second.energy).toBeGreaterThan(first.energy);
    expect(new Set([first.model, second.model]).size).toBeGreaterThan(1);
  });

  it("removes the demo core", () => {
    const cores = new Map([[DEMO_CORE_ID, core(DEMO_CORE_ID)]]);
    removeDemoFlowCore(cores);
    expect(cores.has(DEMO_CORE_ID)).toBe(false);
  });
});

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
