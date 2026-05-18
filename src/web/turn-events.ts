import type { CoreState, ViewportSize } from "./core-state.js";
import { modelAccent } from "./model-visuals.js";
import type { SnapshotEvent, TurnEvent } from "./stream-client.js";
import type { TurnMessage } from "../shared/protocol.js";

interface HudLike {
  updateTurn(source: string, model: string, turns: number, outputTokens: number, energy: number): void;
}

interface ParticleLike {
  spawn(target: CoreState, count: number, color: string, viewport: ViewportSize, isSelf: boolean): void;
}

export interface TurnEventDeps {
  cores: Map<string, CoreState>;
  particles: ParticleLike;
  hud: HudLike;
  selfId: string;
  viewport: ViewportSize;
  now?: () => number;
}

export function applyTurnEvent(ownerId: string, event: TurnEvent | TurnMessage, deps: TurnEventDeps): boolean {
  const core = deps.cores.get(ownerId);
  if (!core) return false;

  const color = modelAccent(event.source, event.model, core.color);
  const count = Math.min(Math.ceil(event.delta.outputTokens / 6), 48);
  const isSelf = ownerId === deps.selfId;
  deps.particles.spawn(core, count, color, deps.viewport, isSelf);

  applyCoreEventState(core, event.energy, event.source, event.model, deps.now?.() ?? Date.now());
  if (isSelf) deps.hud.updateTurn(event.source, event.model, event.totals.turns, event.totals.outputTokens, event.energy);
  return true;
}

export function applySnapshotEvent(ownerId: string, event: SnapshotEvent, deps: Omit<TurnEventDeps, "particles">): boolean {
  const core = deps.cores.get(ownerId);
  if (!core) return false;

  applyCoreEventState(core, event.energy, event.source, event.model, deps.now?.() ?? Date.now());
  if (ownerId === deps.selfId) deps.hud.updateTurn(event.source, event.model, event.totals.turns, event.totals.outputTokens, event.energy);
  return true;
}

function applyCoreEventState(core: CoreState, energy: number, source: string, model: string, timestamp: number): void {
  core.targetEnergy = energy;
  core.lastTurnAt = timestamp;
  core.lastSource = source;
  core.lastModel = model;
}
