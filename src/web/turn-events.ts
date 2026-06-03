import { applyPlanetState, recordPlanetUse, resetPlanetUse, type CoreState, type ViewportSize } from "./core-state.js";
import { modelAccent, modelTrait, modelVisual, PLANET_META, type PlanetClass } from "./model-visuals.js";
import type { ParticleSpawnOptions } from "./particles.js";
import type { SnapshotEvent, TurnEvent } from "./stream-client.js";
import type { PresenceSnapshotMessage, TurnMessage } from "../shared/protocol.js";
import type { WirePlanetState } from "../shared/planet.js";

interface HudLike {
  updateTurn(source: string, model: string, turns: number, outputTokens: number, energy: number, planetClass?: PlanetClass, mixLabel?: string): void;
}

interface ParticleLike {
  spawn(target: CoreState, count: number, color: string, viewport: ViewportSize, isSelf: boolean, options?: ParticleSpawnOptions): void;
}

export interface TurnEventDeps {
  cores: Map<string, CoreState>;
  particles: ParticleLike;
  hud: HudLike;
  selfId: string;
  viewport: ViewportSize;
  now?: () => number;
  shouldUpdateHud?: (ownerId: string) => boolean;
}

export function applyTurnEvent(ownerId: string, event: TurnEvent | TurnMessage, deps: TurnEventDeps): boolean {
  const core = deps.cores.get(ownerId);
  if (!core) return false;

  const color = modelAccent(event.source, event.model, core.color);
  const trait = modelTrait(event.source, event.model);
  const count = Math.min(Math.ceil((event.delta.outputTokens / 12) * trait.particleBurst), 42);
  const isSelf = ownerId === deps.selfId;
  deps.particles.spawn(core, count, color, deps.viewport, isSelf, {
    speed: trait.particleSpeed,
    spread: trait.particleSpread,
    life: trait.particleLife,
    pull: trait.particlePull,
  });

  const planetClass = modelVisual(event.source, event.model, core.color).planetClass;
  const timestamp = deps.now?.() ?? Date.now();
  recordGameProgress(core, event.source, event.model, planetClass, Math.max(1, event.delta.outputTokens), timestamp);
  applyCoreEventState(core, event.energy, event.source, event.model, timestamp, trait);
  const planetState = getPlanetState(event);
  if (planetState) {
    applyPlanetState(core, planetState);
  } else {
    recordPlanetUse(core, planetClass, Math.max(1, event.delta.outputTokens), timestamp);
  }
  if (shouldUpdateHud(ownerId, deps)) {
    deps.hud.updateTurn(event.source, event.model, event.totals.turns, event.totals.outputTokens, core.targetEnergy, core.dominantPlanetClass, formatPlanetMix(core));
  }
  return true;
}

export function recordGameProgress(core: CoreState, source: string, model: string, planetClass: PlanetClass, outputTokens: number, timestamp: number): void {
  core.combo = timestamp - core.lastComboAt <= 9_000 ? Math.min(core.combo + 1, 9) : 1;
  core.lastComboAt = timestamp;
  core.shards = Math.min(99, core.shards + Math.max(1, Math.round(Math.sqrt(outputTokens) / 9)));
  core.evolutionCharge = Math.min(1, core.evolutionCharge + Math.min(outputTokens / 18_000, 0.18));
  recordSatellite(core, source, model, planetClass, outputTokens, timestamp);
}

function recordSatellite(core: CoreState, source: string, model: string, planetClass: PlanetClass, outputTokens: number, timestamp: number): void {
  const key = `${source}:${model}`;
  let satellite = core.satellites.find((item) => item.key === key);
  if (!satellite) {
    satellite = {
      key,
      source,
      model,
      planetClass,
      weight: 0,
      lastTurnAt: timestamp,
      angle: hashUnit(key) * Math.PI * 2,
    };
    core.satellites.push(satellite);
  }
  satellite.planetClass = planetClass;
  satellite.weight = Math.min(1, satellite.weight + Math.max(0.08, Math.sqrt(outputTokens) / 90));
  satellite.lastTurnAt = timestamp;
  core.satellites = core.satellites
    .sort((a, b) => b.weight - a.weight || b.lastTurnAt - a.lastTurnAt)
    .slice(0, 5);
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

export function applySnapshotEvent(ownerId: string, event: SnapshotEvent | PresenceSnapshotMessage, deps: Omit<TurnEventDeps, "particles">): boolean {
  const core = deps.cores.get(ownerId);
  if (!core) return false;

  const trait = modelTrait(event.source, event.model);
  const planetClass = modelVisual(event.source, event.model, core.color).planetClass;
  const timestamp = deps.now?.() ?? Date.now();
  applyCoreEventState(core, event.energy, event.source, event.model, timestamp, trait);
  const planetState = getPlanetState(event);
  if (planetState) {
    applyPlanetState(core, planetState);
  } else {
    resetPlanetUse(core, planetClass, Math.max(1, event.totals.outputTokens), timestamp);
  }
  if (shouldUpdateHud(ownerId, deps)) {
    deps.hud.updateTurn(event.source, event.model, event.totals.turns, event.totals.outputTokens, core.targetEnergy, core.dominantPlanetClass, formatPlanetMix(core));
  }
  return true;
}

function getPlanetState(event: TurnEvent | TurnMessage | SnapshotEvent | PresenceSnapshotMessage): WirePlanetState | undefined {
  return "planetState" in event ? event.planetState : undefined;
}

function shouldUpdateHud(ownerId: string, deps: Omit<TurnEventDeps, "particles">): boolean {
  return deps.shouldUpdateHud?.(ownerId) ?? ownerId === deps.selfId;
}

function applyCoreEventState(core: CoreState, energy: number, source: string, model: string, timestamp: number, trait: ReturnType<typeof modelTrait>): void {
  core.targetEnergy = energy * trait.energyYield;
  core.lastTurnAt = timestamp;
  core.lastSource = source;
  core.lastModel = model;
  core.auraScale = trait.auraScale;
  core.growthScale = trait.growthScale;
  core.resourceBoost = trait.energyYield;
}

function formatPlanetMix(core: CoreState): string {
  const entries = Object.entries(core.planetMix)
    .map(([planetClass, value]) => [planetClass as PlanetClass, value ?? 0] as const)
    .filter(([, value]) => value > 0.04)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  if (!entries.length) return PLANET_META.drift.label;
  return entries.map(([planetClass, value]) => `${PLANET_META[planetClass].label} ${Math.round(value * 100)}%`).join(" / ");
}
