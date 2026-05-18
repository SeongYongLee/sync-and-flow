import { describe, expect, it } from "vitest";
import { renderGridPattern } from "../src/web/grid.js";

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
