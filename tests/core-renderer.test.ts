import { describe, expect, it } from "vitest";
import { displayCoreRadius, rawCoreRadius, updateCoreMotion } from "../src/web/core-renderer.js";
import type { CoreState } from "../src/web/core-state.js";

function core(overrides: Partial<CoreState> = {}): CoreState {
  return {
    id: "core",
    nickname: "core",
    color: "#80b4ff",
    x: 0,
    y: 0,
    tx: 100,
    ty: 50,
    energy: 0,
    targetEnergy: 100,
    pulse: 0,
    lastTurnAt: 0,
    noisePhase: 0,
    ringAngles: [0, 0],
    lastSource: "",
    lastModel: "",
    ...overrides,
  };
}

describe("core renderer helpers", () => {
  it("computes larger self radii than peer radii", () => {
    const state = core({ energy: 100 });

    expect(rawCoreRadius(state, true, false)).toBeCloseTo(30.5);
    expect(rawCoreRadius(state, false, false)).toBeCloseTo(16.8);
  });

  it("caps peer display radius by viewport size", () => {
    const state = core({ energy: 10_000 });

    expect(displayCoreRadius(state, false, { width: 200, height: 100 }, false)).toBeCloseTo(7);
    expect(displayCoreRadius(state, true, { width: 200, height: 100 }, false)).toBeGreaterThan(7);
  });

  it("advances core position, energy, pulse, noise, and ring angles", () => {
    const state = core();

    updateCoreMotion(state, 1);

    expect(state.x).toBeGreaterThan(0);
    expect(state.y).toBeGreaterThan(0);
    expect(state.energy).toBeGreaterThan(0);
    expect(state.pulse).toBeCloseTo(0.04);
    expect(state.noisePhase).toBeCloseTo(0.018);
    expect(state.ringAngles[0]).toBeCloseTo(0.007);
    expect(state.ringAngles[1]).toBeCloseTo(-0.01);
  });
});
