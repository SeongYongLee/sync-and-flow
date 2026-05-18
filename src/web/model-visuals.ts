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
  ringCount: 1 | 2;
  ringAlpha: number;
  ringScale: number;
  spotAlpha: number;
}

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
    return { accentRgb, bandAlpha: 0.22, bandWidth: 1.25, glowAlpha: 1.15, ringCount: 2, ringAlpha: 1.15, ringScale: 1.12, spotAlpha: 1.1 };
  }
  if (key.includes("haiku")) {
    return { accentRgb, bandAlpha: 0.14, bandWidth: 0.8, glowAlpha: 0.9, ringCount: 1, ringAlpha: 0.75, ringScale: 0.92, spotAlpha: 1.25 };
  }
  if (key.includes("sonnet") || key.includes("claude")) {
    return { accentRgb, bandAlpha: 0.18, bandWidth: 1.05, glowAlpha: 1, ringCount: 2, ringAlpha: 1, ringScale: 1, spotAlpha: 1 };
  }
  if (key.includes("gpt") || key.includes("codex") || key.includes("openai")) {
    return { accentRgb, bandAlpha: 0.2, bandWidth: 0.9, glowAlpha: 1.1, ringCount: 2, ringAlpha: 1.05, ringScale: 1.05, spotAlpha: 0.8 };
  }
  if (key.includes("gemini") || key.includes("google")) {
    return { accentRgb, bandAlpha: 0.16, bandWidth: 1.15, glowAlpha: 1, ringCount: 1, ringAlpha: 1.2, ringScale: 1.18, spotAlpha: 1.35 };
  }
  if (key.includes("cursor") || key.includes("copilot") || key.includes("antigravity")) {
    return { accentRgb, bandAlpha: 0.17, bandWidth: 0.95, glowAlpha: 0.95, ringCount: 2, ringAlpha: 0.85, ringScale: 0.95, spotAlpha: 1.15 };
  }

  return { accentRgb, bandAlpha: 0.14, bandWidth: 1, glowAlpha: 0.9, ringCount: 2, ringAlpha: 0.8, ringScale: 1, spotAlpha: 0.8 };
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
