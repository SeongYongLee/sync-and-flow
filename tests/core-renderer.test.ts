import { describe, expect, it } from "vitest";
import { coreActivityAlpha, displayCoreRadius, energyVisualLevel, rawCoreRadius, updateCoreMotion, visualMorphStep, visualTurnIntensity } from "../src/web/core-renderer.js";
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
    combo: 0,
    lastComboAt: 0,
    shards: 0,
    evolutionCharge: 0,
    satellites: [],
    ...overrides,
  };
}

describe("core renderer helpers", () => {
  it("computes larger self radii than peer radii", () => {
    const state = core({ energy: 100 });

    expect(rawCoreRadius(state, true, false)).toBeCloseTo(32.0831);
    expect(rawCoreRadius(state, false, false)).toBeCloseTo(17.5237);
  });

  it("maps accumulated energy to a soft visual level without a finite cap", () => {
    expect(energyVisualLevel(0)).toBe(0);
    expect(energyVisualLevel(100)).toBeGreaterThan(0.2);
    expect(energyVisualLevel(1_000_000)).toBeLessThan(0.6);
    expect(energyVisualLevel(700_000)).toBeLessThan(1);
    expect(energyVisualLevel(10_000_000)).toBeGreaterThan(energyVisualLevel(1_000_000));
    expect(energyVisualLevel(1_000_000_000_000)).toBeGreaterThan(energyVisualLevel(100_000_000));
    expect(energyVisualLevel(1_000_000_000_000)).toBeLessThan(1);
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
    expect(state.pulse).toBeCloseTo(0.028);
    expect(state.noisePhase).toBeCloseTo(0.012);
    expect(state.ringAngles[0]).toBeCloseTo(0.00504);
    expect(state.ringAngles[1]).toBeCloseTo(-0.0072);
  });

  it("animates high-energy cores more aggressively than low-energy cores", () => {
    const low = core({ energy: 40, targetEnergy: 40 });
    const high = core({ energy: 700_000, targetEnergy: 700_000 });

    updateCoreMotion(low, 1);
    updateCoreMotion(high, 1);

    expect(high.pulse).toBeGreaterThan(low.pulse);
    expect(high.noisePhase).toBeGreaterThan(low.noisePhase);
    expect(Math.abs(high.ringAngles[0])).toBeGreaterThan(Math.abs(low.ringAngles[0]));
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
