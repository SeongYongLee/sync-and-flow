import { describe, expect, it } from "vitest";
import { ParticleSystem, particleAbsorbRadius, shouldAbsorbParticle, shouldAbsorbParticleAtRadius } from "../src/web/particles.js";

describe("ParticleSystem", () => {
  it("caps particle count after spawn", () => {
    const particles = new ParticleSystem(3);
    const target = { id: "core", x: 100, y: 100 };

    particles.spawn(target, 5, "255, 255, 255", { width: 800, height: 600 }, true);

    expect(particles.size).toBe(3);
  });

  it("removes particles whose target no longer exists", () => {
    const particles = new ParticleSystem(10);
    const target = { id: "core", x: 100, y: 100 };
    const ctx = fakeCanvasContext();

    particles.spawn(target, 2, "255, 255, 255", { width: 800, height: 600 }, false);
    particles.draw(ctx, new Map(), 1);

    expect(particles.size).toBe(0);
  });

  it("absorbs particles before they pass through the core", () => {
    expect(shouldAbsorbParticle(42, 24)).toBe(true);
    expect(shouldAbsorbParticle(42, 58)).toBe(true);
    expect(shouldAbsorbParticle(120, 92)).toBe(false);
  });

  it("scales absorption radius with the visible core size", () => {
    expect(particleAbsorbRadius({ id: "small", x: 0, y: 0, absorbRadius: 14 })).toBeCloseTo(12);
    expect(particleAbsorbRadius({ id: "large", x: 0, y: 0, absorbRadius: 60 })).toBeCloseTo(43.2);
    expect(shouldAbsorbParticleAtRadius(18, 15, particleAbsorbRadius({ id: "small", x: 0, y: 0, absorbRadius: 14 }))).toBe(false);
    expect(shouldAbsorbParticleAtRadius(18, 15, particleAbsorbRadius({ id: "large", x: 0, y: 0, absorbRadius: 60 }))).toBe(true);
  });
});

function fakeCanvasContext(): CanvasRenderingContext2D {
  return {
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    set strokeStyle(_value: string) {},
    set lineWidth(_value: number) {},
    set lineCap(_value: CanvasLineCap) {},
  } as unknown as CanvasRenderingContext2D;
}
