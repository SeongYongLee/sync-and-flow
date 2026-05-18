import type { Usage, TurnCost } from "./types.js";
import pricingTable from "./pricing-table.json" assert { type: "json" };

interface ModelPricing {
  input: number;
  output: number;
  cache_creation_5m: number;
  cache_creation_1h: number;
  cache_read: number;
}

const table = pricingTable as unknown as Record<string, ModelPricing>;

const PREFIXES = [
  "claude-opus-4",
  "claude-sonnet-4",
  "claude-haiku-4",
] as const;

function lookupPricing(model: string): ModelPricing {
  if (model in table) return table[model] as ModelPricing;

  for (const prefix of PREFIXES) {
    if (model.startsWith(prefix)) {
      const entry = Object.entries(table).find(([k]) => k.startsWith(prefix));
      if (entry) return entry[1];
    }
  }

  // unknown model — fallback to sonnet pricing with a warning
  console.warn(`[pricing] Unknown model "${model}", falling back to claude-sonnet-4-6 pricing`);
  return table["claude-sonnet-4-6"] as ModelPricing;
}

const M = 1_000_000;

export function calcCost(model: string, usage: Usage): TurnCost {
  const p = lookupPricing(model);

  const cc = usage.cache_creation;
  const create5mTokens = cc?.ephemeral_5m_input_tokens ?? 0;
  const create1hTokens = (cc?.ephemeral_1h_input_tokens ?? 0) +
    // If no cache_creation breakdown available, all creation goes to 1h rate
    (cc ? 0 : usage.cache_creation_input_tokens);

  const inputUsd = (usage.input_tokens / M) * p.input;
  const outputUsd = (usage.output_tokens / M) * p.output;
  const cacheCreate5mUsd = (create5mTokens / M) * p.cache_creation_5m;
  const cacheCreate1hUsd = (create1hTokens / M) * p.cache_creation_1h;
  const cacheReadUsd = (usage.cache_read_input_tokens / M) * p.cache_read;

  const totalUsd = inputUsd + outputUsd + cacheCreate5mUsd + cacheCreate1hUsd + cacheReadUsd;

  return { inputUsd, outputUsd, cacheCreate5mUsd, cacheCreate1hUsd, cacheReadUsd, totalUsd };
}
