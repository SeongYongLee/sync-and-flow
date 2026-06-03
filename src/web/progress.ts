import { EMPTY_PLANET_STATE, type WirePlanetState } from "../shared/planet.js";
import type { WireTotals } from "../shared/protocol.js";
import type { CoreState } from "./core-state.js";
import { coreToWirePlanetState } from "./core-state.js";
import type { SnapshotEvent, TurnEvent } from "./stream-client.js";

const PROGRESS_PREFIX = "sf:progress:v1:";

export interface StoredProgress {
  version: 1;
  userId: string;
  source: string;
  provider: string;
  model: string;
  totals: WireTotals;
  sourceTotals: Record<string, WireTotals>;
  energy: number;
  planetState: WirePlanetState;
  updatedAt: string;
}

export function loadProgress(userId: string): StoredProgress | null {
  try {
    const raw = localStorage.getItem(progressKey(userId));
    if (!raw) return null;
    return parseProgress(JSON.parse(raw), userId);
  } catch {
    return null;
  }
}

export function clearProgress(userId: string): void {
  localStorage.removeItem(progressKey(userId));
}

export interface ProgressSummary {
  saved: string;
  updatedAt: string;
  model: string;
  turns: string;
  outputTokens: string;
  energy: string;
  planet: string;
}

export function formatProgressSummary(progress: StoredProgress | null): ProgressSummary {
  if (!progress) {
    return {
      saved: "Not saved yet",
      updatedAt: "-",
      model: "-",
      turns: "0",
      outputTokens: "0",
      energy: "0 flow",
      planet: "-",
    };
  }

  return {
    saved: "Saved locally",
    updatedAt: formatStoredTime(progress.updatedAt),
    model: progress.source && progress.model ? `${progress.source}:${progress.model}` : "-",
    turns: progress.totals.turns.toLocaleString(),
    outputTokens: progress.totals.outputTokens.toLocaleString(),
    energy: `${Math.round(progress.energy).toLocaleString()} flow`,
    planet: progress.planetState.dominant,
  };
}

export function saveTurnProgress(userId: string, event: TurnEvent, core: CoreState, now: () => Date = () => new Date()): StoredProgress | null {
  const existing = loadProgress(userId);
  const sourceTotals = {
    ...(existing?.sourceTotals ?? {}),
    [sourceKey(event.source, event.provider, event.model)]: cloneTotals(event.sourceTotals ?? event.totals),
  };

  return saveProgress({
    version: 1,
    userId,
    source: event.source,
    provider: event.provider,
    model: event.model,
    totals: cloneTotals(event.totals),
    sourceTotals,
    energy: event.energy,
    planetState: coreToWirePlanetState(core),
    updatedAt: now().toISOString(),
  });
}

export function saveSnapshotProgress(userId: string, event: SnapshotEvent, core: CoreState, now: () => Date = () => new Date()): StoredProgress | null {
  const existing = loadProgress(userId);
  return saveProgress({
    version: 1,
    userId,
    source: event.source,
    provider: existing?.provider ?? "",
    model: event.model,
    totals: cloneTotals(event.totals),
    sourceTotals: existing?.sourceTotals ?? {},
    energy: event.energy,
    planetState: coreToWirePlanetState(core),
    updatedAt: now().toISOString(),
  });
}

export function progressToSnapshot(progress: StoredProgress): SnapshotEvent {
  return {
    type: "snapshot",
    source: progress.source,
    model: progress.model,
    totals: cloneTotals(progress.totals),
    energy: progress.energy,
    timestamp: progress.updatedAt,
    planetState: progress.planetState,
  };
}

function saveProgress(progress: StoredProgress): StoredProgress | null {
  try {
    localStorage.setItem(progressKey(progress.userId), JSON.stringify(progress));
    return progress;
  } catch {
    return null;
  }
}

function parseProgress(value: unknown, userId: string): StoredProgress | null {
  if (!isRecord(value) || value["version"] !== 1 || value["userId"] !== userId) return null;
  const totals = parseTotals(value["totals"]);
  if (!totals) return null;

  return {
    version: 1,
    userId,
    source: typeof value["source"] === "string" ? value["source"] : "",
    provider: typeof value["provider"] === "string" ? value["provider"] : "",
    model: typeof value["model"] === "string" ? value["model"] : "",
    totals,
    sourceTotals: parseSourceTotals(value["sourceTotals"]),
    energy: finiteNumber(value["energy"]) ?? 0,
    planetState: parsePlanetState(value["planetState"]) ?? EMPTY_PLANET_STATE,
    updatedAt: typeof value["updatedAt"] === "string" ? value["updatedAt"] : "",
  };
}

function parseSourceTotals(value: unknown): Record<string, WireTotals> {
  if (!isRecord(value)) return {};
  const result: Record<string, WireTotals> = {};
  for (const [key, totals] of Object.entries(value)) {
    const parsed = parseTotals(totals);
    if (parsed) result[key] = parsed;
  }
  return result;
}

function parseTotals(value: unknown): WireTotals | null {
  if (!isRecord(value)) return null;
  const outputTokens = nonNegativeInteger(value["outputTokens"]);
  const inputTokens = nonNegativeInteger(value["inputTokens"]);
  const cacheReadTokens = nonNegativeInteger(value["cacheReadTokens"]);
  const turns = nonNegativeInteger(value["turns"]);
  const totalUsd = finiteNumber(value["totalUsd"]);
  if (outputTokens === null || inputTokens === null || cacheReadTokens === null || turns === null || totalUsd === null) return null;
  return { outputTokens, inputTokens, cacheReadTokens, turns, totalUsd };
}

function parsePlanetState(value: unknown): WirePlanetState | null {
  if (!isRecord(value)) return null;
  if (typeof value["dominant"] !== "string") return null;
  return value as unknown as WirePlanetState;
}

function cloneTotals(totals: WireTotals): WireTotals {
  return { ...totals };
}

function sourceKey(source: string, provider: string, model: string): string {
  return `${source}:${provider}:${model}`;
}

function progressKey(userId: string): string {
  return `${PROGRESS_PREFIX}${userId}`;
}

function formatStoredTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value || "-";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
