import { describe, expect, it } from "vitest";
import { coreActivityAlpha, displayCoreRadius, rawCoreRadius, updateCoreMotion, visualMorphStep, visualTurnIntensity } from "../src/web/core-renderer.js";
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
    planetHistory: [],
    planetMix: { drift: 1 },
    dominantPlanetClass: "drift",
    secondaryPlanetClass: null,
    auraScale: 1,
    growthScale: 1,
    resourceBoost: 1,
    ...overrides,
  };
}

describe("core renderer helpers", () => {
  it("computes larger self radii than peer radii", () => {
    const state = core({ energy: 100 });

    expect(rawCoreRadius(state, true, false)).toBeCloseTo(30.5);
    expect(rawCoreRadius(state, false, false)).toBeCloseTo(16.8);
  });

  it("caps display radius by viewport size", () => {
    const state = core({ energy: 10_000 });

    expect(displayCoreRadius(state, false, { width: 200, height: 100 }, false)).toBeCloseTo(7);
    expect(displayCoreRadius(state, true, { width: 200, height: 100 }, false)).toBeCloseTo(16);
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

  it("speeds up visual morphing after recent high-energy turns", () => {
    const now = 1_000_000;
    const idle = core({ energy: 100, targetEnergy: 100, lastTurnAt: 0 });
    const active = core({ energy: 10, targetEnergy: 370, lastTurnAt: now });

    expect(visualMorphStep(active, 1, now)).toBeGreaterThan(visualMorphStep(idle, 1, now));
    expect(visualTurnIntensity(active, now)).toBeGreaterThan(visualTurnIntensity(idle, now));
  });

  it("lets recent turn intensity fade over time", () => {
    const now = 1_000_000;
    const state = core({ energy: 10, targetEnergy: 120, lastTurnAt: now });

    expect(visualTurnIntensity(state, now + 1_000)).toBeGreaterThan(visualTurnIntensity(state, now + 12_000));
  });

  it("dims stale peer cores without dimming self", () => {
    const now = 100_000;
    const state = core({ lastTurnAt: now - 50_000 });

    expect(coreActivityAlpha(state, false, now)).toBeLessThan(1);
    expect(coreActivityAlpha(state, true, now)).toBe(1);
  });
});
