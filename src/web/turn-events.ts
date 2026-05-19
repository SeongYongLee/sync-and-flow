import type { CoreState, ViewportSize } from "./core-state.js";
import { modelAccent, modelTrait } from "./model-visuals.js";
import type { ParticleSpawnOptions } from "./particles.js";
import type { SnapshotEvent, TurnEvent } from "./stream-client.js";
import type { TurnMessage } from "../shared/protocol.js";

interface HudLike {
  updateTurn(source: string, model: string, turns: number, outputTokens: number, energy: number): void;
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
  const count = Math.min(Math.ceil((event.delta.outputTokens / 6) * trait.particleBurst), 64);
  const isSelf = ownerId === deps.selfId;
  deps.particles.spawn(core, count, color, deps.viewport, isSelf, {
    speed: trait.particleSpeed,
    spread: trait.particleSpread,
    life: trait.particleLife,
    pull: trait.particlePull,
  });

  applyCoreEventState(core, event.energy, event.source, event.model, deps.now?.() ?? Date.now());
  if (shouldUpdateHud(ownerId, deps)) deps.hud.updateTurn(event.source, event.model, event.totals.turns, event.totals.outputTokens, event.energy);
  return true;
}

export function applySnapshotEvent(ownerId: string, event: SnapshotEvent, deps: Omit<TurnEventDeps, "particles">): boolean {
  const core = deps.cores.get(ownerId);
  if (!core) return false;

  applyCoreEventState(core, event.energy, event.source, event.model, deps.now?.() ?? Date.now());
  if (shouldUpdateHud(ownerId, deps)) deps.hud.updateTurn(event.source, event.model, event.totals.turns, event.totals.outputTokens, event.energy);
  return true;
}

function shouldUpdateHud(ownerId: string, deps: Omit<TurnEventDeps, "particles">): boolean {
  return deps.shouldUpdateHud?.(ownerId) ?? ownerId === deps.selfId;
}

function applyCoreEventState(core: CoreState, energy: number, source: string, model: string, timestamp: number): void {
  core.targetEnergy = energy;
  core.lastTurnAt = timestamp;
  core.lastSource = source;
  core.lastModel = model;
}
