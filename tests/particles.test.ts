import { describe, expect, it } from "vitest";
import { ParticleSystem } from "../src/web/particles.js";

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
