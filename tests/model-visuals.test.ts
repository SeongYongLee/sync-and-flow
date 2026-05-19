import { describe, expect, it } from "vitest";
import { hexToRgb, modelAccent, modelTrait, modelVisual, planetVariant } from "../src/web/model-visuals.js";

describe("model visuals", () => {
  it("maps known providers and model families to stable accents", () => {
    expect(modelAccent("claude", "claude-opus-4-7", "#ffffff")).toBe("197, 140, 255");
    expect(modelAccent("codex", "gpt-5-codex", "#ffffff")).toBe("255, 176, 80");
    expect(modelAccent("gemini-cli", "gemini-pro", "#ffffff")).toBe("110, 231, 249");
  });

  it("falls back to hex color conversion for unknown models", () => {
    expect(hexToRgb("#abc")).toBe("170, 187, 204");
    expect(modelAccent("unknown", "unknown", "#123456")).toBe("18, 52, 86");
  });

  it("returns deterministic planet variants", () => {
    expect(planetVariant("peer-1", false)).toEqual(planetVariant("peer-1", false));
    expect(planetVariant("me", true)).toMatchObject({ squashX: 1, squashY: 1, bandCount: 7 });
  });

  it("exposes model-specific visual differences", () => {
    expect(modelVisual("claude", "claude-haiku-4", "#ffffff").ringCount).toBe(1);
    expect(modelVisual("claude", "claude-opus-4", "#ffffff").ringAlpha).toBeGreaterThan(1);
    expect(modelVisual("claude", "claude-sonnet-4", "#ffffff").planetClass).toBe("nebula");
    expect(modelVisual("codex", "gpt-5-codex", "#ffffff").planetClass).toBe("forge");
    expect(modelVisual("gemini-cli", "gemini-pro", "#ffffff").planetClass).toBe("prism");
    expect(modelVisual("copilot", "gpt-4.1", "#ffffff").planetClass).toBe("grove");
    expect(modelVisual("cursor", "cursor-agent", "#ffffff").planetClass).toBe("relay");
  });

  it("exposes model-specific gameplay traits", () => {
    expect(modelTrait("codex", "gpt-5-codex").particleBurst).toBeGreaterThan(modelTrait("claude", "claude-sonnet-4").particleBurst);
    expect(modelTrait("cursor", "cursor-agent").particlePull).toBeGreaterThan(modelTrait("copilot", "gpt-4.1").particlePull);
    expect(modelTrait("gemini-cli", "gemini-pro").particleSpread).toBeGreaterThan(modelTrait("codex", "gpt-5-codex").particleSpread);
  });
});
