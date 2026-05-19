export interface PlanetVariant {
  squashX: number;
  squashY: number;
  bandCount: number;
  bandWave: number;
  bandSlant: number;
  spotCount: number;
  ringAlpha: number;
  ringScale: number;
}

export interface ModelVisual {
  accentRgb: string;
  bandAlpha: number;
  bandWidth: number;
  glowAlpha: number;
  planetClass: PlanetClass;
  ringCount: 1 | 2;
  ringAlpha: number;
  ringScale: number;
  squashX: number;
  squashY: number;
  spotAlpha: number;
}

export interface ModelTrait {
  particleBurst: number;
  particleSpeed: number;
  particleSpread: number;
  particleLife: number;
  particlePull: number;
  energyYield: number;
  auraScale: number;
  growthScale: number;
}

export type PlanetClass = "nebula" | "forge" | "prism" | "grove" | "relay" | "drift";

export interface PlanetMeta {
  label: string;
  role: string;
  description: string;
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

const rgbCache = new Map<string, string>();
const variantCache = new Map<string, PlanetVariant>();

export function modelAccent(source: string, model: string, fallback: string): string {
  const key = `${source} ${model}`.toLowerCase();
  if (key.includes("opus")) return "197, 140, 255";
  if (key.includes("haiku")) return "126, 224, 168";
  if (key.includes("sonnet") || key.includes("claude")) return "120, 180, 255";
  if (key.includes("gpt") || key.includes("codex") || key.includes("openai")) return "255, 176, 80";
  if (key.includes("gemini") || key.includes("google")) return "110, 231, 249";
  if (key.includes("copilot") || key.includes("github")) return "126, 224, 168";
  if (key.includes("cursor") || key.includes("antigravity")) return "244, 211, 94";
  return hexToRgb(fallback);
}

export function modelVisual(source: string, model: string, fallback: string): ModelVisual {
  const key = `${source} ${model}`.toLowerCase();
  const accentRgb = modelAccent(source, model, fallback);

  if (key.includes("opus")) {
    return {
      accentRgb,
      bandAlpha: 0.22,
      bandWidth: 1.25,
      glowAlpha: 1.15,
      planetClass: "nebula",
      ringCount: 2,
      ringAlpha: 1.15,
      ringScale: 1.12,
      squashX: 1.04,
      squashY: 0.98,
      spotAlpha: 1.1,
    };
  }
  if (key.includes("haiku")) {
    return {
      accentRgb,
      bandAlpha: 0.14,
      bandWidth: 0.8,
      glowAlpha: 0.9,
      planetClass: "nebula",
      ringCount: 1,
      ringAlpha: 0.75,
      ringScale: 0.92,
      squashX: 0.96,
      squashY: 1.04,
      spotAlpha: 1.25,
    };
  }
  if (key.includes("sonnet") || key.includes("claude")) {
    return {
      accentRgb,
      bandAlpha: 0.18,
      bandWidth: 1.05,
      glowAlpha: 1,
      planetClass: "nebula",
      ringCount: 2,
      ringAlpha: 1,
      ringScale: 1,
      squashX: 1,
      squashY: 1,
      spotAlpha: 1,
    };
  }
  if (key.includes("copilot") || key.includes("github")) {
    return {
      accentRgb,
      bandAlpha: 0.17,
      bandWidth: 0.95,
      glowAlpha: 0.95,
      planetClass: "grove",
      ringCount: 2,
      ringAlpha: 0.85,
      ringScale: 0.95,
      squashX: 0.94,
      squashY: 1.02,
      spotAlpha: 1.15,
    };
  }
  if (key.includes("cursor") || key.includes("antigravity")) {
    return {
      accentRgb,
      bandAlpha: 0.17,
      bandWidth: 0.95,
      glowAlpha: 0.95,
      planetClass: "relay",
      ringCount: 2,
      ringAlpha: 0.85,
      ringScale: 0.95,
      squashX: 1.02,
      squashY: 0.96,
      spotAlpha: 1.15,
    };
  }
  if (key.includes("gpt") || key.includes("codex") || key.includes("openai")) {
    return {
      accentRgb,
      bandAlpha: 0.2,
      bandWidth: 0.9,
      glowAlpha: 1.1,
      planetClass: "forge",
      ringCount: 2,
      ringAlpha: 1.05,
      ringScale: 1.05,
      squashX: 1.08,
      squashY: 0.94,
      spotAlpha: 0.8,
    };
  }
  if (key.includes("gemini") || key.includes("google")) {
    return {
      accentRgb,
      bandAlpha: 0.16,
      bandWidth: 1.15,
      glowAlpha: 1,
      planetClass: "prism",
      ringCount: 1,
      ringAlpha: 1.2,
      ringScale: 1.18,
      squashX: 0.98,
      squashY: 1.08,
      spotAlpha: 1.35,
    };
  }

  return {
    accentRgb,
    bandAlpha: 0.14,
    bandWidth: 1,
    glowAlpha: 0.9,
    planetClass: "drift",
    ringCount: 2,
    ringAlpha: 0.8,
    ringScale: 1,
    squashX: 1,
    squashY: 1,
    spotAlpha: 0.8,
  };
}

export function modelTrait(source: string, model: string): ModelTrait {
  const planetClass = modelVisual(source, model, "#c8c8c8").planetClass;
  if (planetClass === "nebula") {
    return { particleBurst: 0.95, particleSpeed: 0.88, particleSpread: 1.25, particleLife: 1.28, particlePull: 0.92, energyYield: 1, auraScale: 1.18, growthScale: 0.96 };
  }
  if (planetClass === "forge") {
    return { particleBurst: 1.25, particleSpeed: 1.18, particleSpread: 0.82, particleLife: 0.9, particlePull: 1.06, energyYield: 1.08, auraScale: 0.95, growthScale: 1.12 };
  }
  if (planetClass === "prism") {
    return { particleBurst: 1.08, particleSpeed: 1.24, particleSpread: 1.5, particleLife: 1, particlePull: 0.96, energyYield: 1.02, auraScale: 1.06, growthScale: 1 };
  }
  if (planetClass === "grove") {
    return { particleBurst: 1.15, particleSpeed: 0.84, particleSpread: 1.1, particleLife: 1.35, particlePull: 0.88, energyYield: 0.98, auraScale: 1.22, growthScale: 1.04 };
  }
  if (planetClass === "relay") {
    return { particleBurst: 1, particleSpeed: 1.38, particleSpread: 0.68, particleLife: 0.86, particlePull: 1.28, energyYield: 1.03, auraScale: 0.9, growthScale: 1.02 };
  }
  return { particleBurst: 1, particleSpeed: 1, particleSpread: 1, particleLife: 1, particlePull: 1, energyYield: 1, auraScale: 1, growthScale: 1 };
}

export function hexToRgb(hex: string): string {
  const cached = rgbCache.get(hex);
  if (cached) return cached;

  const value = hex.replace("#", "");
  const n = Number.parseInt(value.length === 3 ? value.split("").map((c) => c + c).join("") : value, 16);
  const rgb = Number.isFinite(n) ? `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}` : "200, 200, 200";
  rgbCache.set(hex, rgb);
  return rgb;
}

export function planetVariant(id: string, isSelf: boolean): PlanetVariant {
  const cacheKey = `${id}:${isSelf ? "self" : "peer"}`;
  const cached = variantCache.get(cacheKey);
  if (cached) return cached;

  const variant = isSelf
    ? {
        squashX: 1,
        squashY: 1,
        bandCount: 7,
        bandWave: 0.08,
        bandSlant: 0,
        spotCount: 5,
        ringAlpha: 1,
        ringScale: 1,
      }
    : {
        squashX: 0.92 + hashUnit(id, 11) * 0.2,
        squashY: 0.88 + hashUnit(id, 23) * 0.22,
        bandCount: 3 + Math.floor(hashUnit(id, 37) * 4),
        bandWave: 0.04 + hashUnit(id, 41) * 0.1,
        bandSlant: (hashUnit(id, 53) - 0.5) * 0.7,
        spotCount: 1 + Math.floor(hashUnit(id, 67) * 4),
        ringAlpha: 0.55 + hashUnit(id, 71) * 0.45,
        ringScale: 0.88 + hashUnit(id, 83) * 0.28,
      };

  variantCache.set(cacheKey, variant);
  return variant;
}

function hashUnit(id: string, salt: number): number {
  let hash = salt;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 10_000) / 10_000;
}
