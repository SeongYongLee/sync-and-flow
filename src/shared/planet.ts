export type PlanetClass = "nebula" | "forge" | "prism" | "grove" | "relay" | "drift";

export interface PlanetMeta {
  label: string;
  role: string;
  description: string;
}

export interface WirePlanetUse {
  planetClass: PlanetClass;
  weight: number;
  timestamp: number;
}

export interface WirePlanetState {
  history: WirePlanetUse[];
  mix: Partial<Record<PlanetClass, number>>;
  dominant: PlanetClass;
  secondary: PlanetClass | null;
}

export const PLANET_META: Record<PlanetClass, PlanetMeta> = {
  nebula: {
    label: "Nebula",
    role: "stable",
    description: "Slow, long-lived flow with a wider atmospheric feel.",
  },
  forge: {
    label: "Forge",
    role: "production",
    description: "Dense bursts, faster growth, and focused energy intake.",
  },
  prism: {
    label: "Prism",
    role: "scatter",
    description: "Wide particle spread with bright, refractive motion.",
  },
  grove: {
    label: "Grove",
    role: "support",
    description: "Persistent flow that lingers and reinforces the field.",
  },
  relay: {
    label: "Relay",
    role: "connection",
    description: "Fast, tightly pulled particles and a sharp signal path.",
  },
  drift: {
    label: "Drift",
    role: "neutral",
    description: "Default behavior for unknown or idle model activity.",
  },
};

export const EMPTY_PLANET_STATE: WirePlanetState = {
  history: [],
  mix: { drift: 1 },
  dominant: "drift",
  secondary: null,
};

const MAX_PLANET_HISTORY = 10;

export function classifyPlanet(source: string, model: string): PlanetClass {
  const key = `${source} ${model}`.toLowerCase();
  if (key.includes("opus") || key.includes("haiku") || key.includes("sonnet") || key.includes("claude")) return "nebula";
  if (key.includes("copilot") || key.includes("github")) return "grove";
  if (key.includes("cursor") || key.includes("antigravity")) return "relay";
  if (key.includes("gpt") || key.includes("codex") || key.includes("openai")) return "forge";
  if (key.includes("gemini") || key.includes("google")) return "prism";
  return "drift";
}

export function recordPlanetStateUse(
  state: WirePlanetState | undefined,
  planetClass: PlanetClass,
  weight: number,
  timestamp: number,
): WirePlanetState {
  const history = [...(state?.history ?? [])];
  history.push({ planetClass, weight: Math.max(1, Math.min(weight, 10_000)), timestamp });
  if (history.length > MAX_PLANET_HISTORY) history.splice(0, history.length - MAX_PLANET_HISTORY);
  return summarizePlanetHistory(history);
}

export function summarizePlanetHistory(history: WirePlanetUse[]): WirePlanetState {
  const totals: Partial<Record<PlanetClass, number>> = {};
  let totalWeight = 0;
  for (const item of history) {
    totals[item.planetClass] = (totals[item.planetClass] ?? 0) + item.weight;
    totalWeight += item.weight;
  }

  if (totalWeight <= 0) return { ...EMPTY_PLANET_STATE, history: [] };

  const entries = Object.entries(totals)
    .map(([planetClass, weight]) => [planetClass as PlanetClass, weight / totalWeight] as const)
    .sort((a, b) => b[1] - a[1]);

  return {
    history,
    mix: Object.fromEntries(entries) as Partial<Record<PlanetClass, number>>,
    dominant: entries[0]?.[0] ?? "drift",
    secondary: entries[1]?.[0] ?? null,
  };
}
