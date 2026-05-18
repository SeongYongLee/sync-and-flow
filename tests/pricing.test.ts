import { describe, it, expect } from "vitest";
import { calcCost } from "../src/core/pricing.js";
import type { Usage } from "../src/core/types.js";

const M = 1_000_000;

describe("calcCost", () => {
  it("calculates sonnet output cost", () => {
    const usage: Usage = {
      input_tokens: 0,
      output_tokens: M, // 1M output tokens = $15
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    const cost = calcCost("claude-sonnet-4-6", usage);
    expect(cost.outputUsd).toBeCloseTo(15.0);
    expect(cost.totalUsd).toBeCloseTo(15.0);
  });

  it("calculates opus input cost", () => {
    const usage: Usage = {
      input_tokens: M, // 1M input tokens = $15
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    const cost = calcCost("claude-opus-4-7", usage);
    expect(cost.inputUsd).toBeCloseTo(15.0);
  });

  it("calculates cache_read cost for sonnet", () => {
    const usage: Usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: M, // 1M = $0.3
    };
    const cost = calcCost("claude-sonnet-4-6", usage);
    expect(cost.cacheReadUsd).toBeCloseTo(0.3);
  });

  it("separates 5m vs 1h cache creation", () => {
    const usage: Usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: M,
      cache_read_input_tokens: 0,
      cache_creation: {
        ephemeral_5m_input_tokens: 500_000,
        ephemeral_1h_input_tokens: 500_000,
      },
    };
    // sonnet: 5m = $3.75/M, 1h = $3.75/M
    const cost = calcCost("claude-sonnet-4-6", usage);
    expect(cost.cacheCreate5mUsd).toBeCloseTo(1.875);
    expect(cost.cacheCreate1hUsd).toBeCloseTo(1.875);
  });

  it("uses model prefix matching for unknown minor version", () => {
    const usage: Usage = {
      input_tokens: 0,
      output_tokens: M,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    // should match claude-sonnet-4 prefix → $15/M output
    const cost = calcCost("claude-sonnet-4-99-preview", usage);
    expect(cost.outputUsd).toBeCloseTo(15.0);
  });

  it("two-models-mixed fixture calculates per model", () => {
    // sonnet: 40 output tokens = 40/1M * 15 = $0.0000006
    const sonnetUsage: Usage = { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const sonnetCost = calcCost("claude-sonnet-4-6", sonnetUsage);

    // opus: 60 output + 500 cache_read
    const opusUsage: Usage = { input_tokens: 200, output_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 };
    const opusCost = calcCost("claude-opus-4-7", opusUsage);

    expect(sonnetCost.totalUsd).toBeGreaterThan(0);
    expect(opusCost.totalUsd).toBeGreaterThan(sonnetCost.totalUsd); // opus is more expensive
  });
});
