import { describe, expect, it } from "vitest";
import { ambientBodiesForBackdrop, backdropDriftForEnergy, gridStepForEnergy, renderGridPattern } from "../src/web/grid.js";

describe("renderGridPattern", () => {
  it("draws vertical and horizontal grid lines at the requested step", () => {
    const ctx = fakeCanvasContext();

    renderGridPattern(ctx.context, { width: 120, height: 90 }, 60);

    expect(ctx.calls).toEqual([
      ["clearRect", 0, 0, 120, 90],
      ["beginPath"],
      ["moveTo", 0, 0],
      ["lineTo", 0, 90],
      ["moveTo", 60, 0],
      ["lineTo", 60, 90],
      ["moveTo", 0, 0],
      ["lineTo", 120, 0],
      ["moveTo", 0, 60],
      ["lineTo", 120, 60],
      ["strokeStyle", "rgba(255, 255, 255, 0.025)"],
      ["lineWidth", 1],
      ["stroke"],
    ]);
  });

  it("shrinks grid spacing continuously as raw energy rises", () => {
    expect(gridStepForEnergy(0)).toBe(72);
    expect(gridStepForEnergy(100)).toBeCloseTo(57.3919);
    expect(gridStepForEnergy(700_000)).toBeCloseTo(33.917);
    expect(gridStepForEnergy(10_000_000)).toBeLessThan(gridStepForEnergy(1_000_000));
    expect(gridStepForEnergy(1_000_000_000_000)).toBeLessThan(gridStepForEnergy(100_000_000));
  });

  it("increases backdrop drift gently with energy", () => {
    expect(backdropDriftForEnergy(0)).toBeCloseTo(0.012);
    expect(backdropDriftForEnergy(700_000)).toBeGreaterThan(backdropDriftForEnergy(100));
    expect(backdropDriftForEnergy(10_000_000)).toBeGreaterThan(backdropDriftForEnergy(700_000));
  });

  it("places deterministic ambient bodies and scales their count with energy", () => {
    const viewport = { width: 800, height: 600 };
    const idle = ambientBodiesForBackdrop(viewport, 0);
    const active = ambientBodiesForBackdrop(viewport, 1_000_000);

    expect(idle.length).toBeGreaterThanOrEqual(4);
    expect(active.length).toBeGreaterThan(idle.length);
    expect(ambientBodiesForBackdrop(viewport, 1_000_000)).toEqual(active);
    expect(active[0]).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      radius: expect.any(Number),
      rgb: expect.any(String),
      alpha: expect.any(Number),
      ring: expect.any(Boolean),
      kind: expect.any(String),
      phase: expect.any(Number),
    });
    expect(new Set(active.map((body) => body.kind)).size).toBeGreaterThan(1);
  });
});

function fakeCanvasContext() {
  const calls: unknown[][] = [];
  const context = {
    clearRect(...args: number[]) {
      calls.push(["clearRect", ...args]);
    },
    beginPath() {
      calls.push(["beginPath"]);
    },
    moveTo(...args: number[]) {
      calls.push(["moveTo", ...args]);
    },
    lineTo(...args: number[]) {
      calls.push(["lineTo", ...args]);
    },
    stroke() {
      calls.push(["stroke"]);
    },
    set strokeStyle(value: string) {
      calls.push(["strokeStyle", value]);
    },
    set lineWidth(value: number) {
      calls.push(["lineWidth", value]);
    },
  } as unknown as CanvasRenderingContext2D;
  return { calls, context };
}
