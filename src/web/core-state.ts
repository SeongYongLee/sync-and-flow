import type { PeerMeta } from "../shared/protocol.js";
import { recordPlanetStateUse, summarizePlanetHistory, type PlanetClass, type WirePlanetState } from "../shared/planet.js";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface CoreState {
  id: string;
  nickname: string;
  color: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  energy: number;
  targetEnergy: number;
  pulse: number;
  lastTurnAt: number;
  noisePhase: number;
  ringAngles: [number, number];
  lastSource: string;
  lastModel: string;
  planetHistory: PlanetUse[];
  planetMix: Partial<Record<PlanetClass, number>>;
  dominantPlanetClass: PlanetClass;
  secondaryPlanetClass: PlanetClass | null;
  auraScale: number;
  growthScale: number;
  resourceBoost: number;
}

export interface PlanetUse {
  planetClass: PlanetClass;
  weight: number;
  timestamp: number;
}

export function ensureCore(
  cores: Map<string, CoreState>,
  peer: PeerMeta,
  viewport: ViewportSize,
  random: () => number = Math.random,
): CoreState {
  let core = cores.get(peer.id);
  if (!core) {
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    core = {
      id: peer.id,
      nickname: peer.nickname,
      color: peer.color,
      x: cx,
      y: cy,
      tx: cx,
      ty: cy,
      energy: 0,
      targetEnergy: 0,
      pulse: random() * Math.PI * 2,
      lastTurnAt: 0,
      noisePhase: random() * Math.PI * 2,
      ringAngles: [random() * Math.PI * 2, random() * Math.PI * 2],
      lastSource: "",
      lastModel: "",
      planetHistory: [],
      planetMix: { drift: 1 },
      dominantPlanetClass: "drift",
      secondaryPlanetClass: null,
      auraScale: 1,
      growthScale: 1,
      resourceBoost: 1,
    };
    cores.set(peer.id, core);
  }
  core.nickname = peer.nickname;
  core.color = peer.color;
  return core;
}

export function recordPlanetUse(core: CoreState, planetClass: PlanetClass, weight: number, timestamp: number): void {
  applyPlanetState(core, recordPlanetStateUse(coreToWirePlanetState(core), planetClass, weight, timestamp));
}

export function resetPlanetUse(core: CoreState, planetClass: PlanetClass, weight: number, timestamp: number): void {
  applyPlanetState(core, summarizePlanetHistory([{ planetClass, weight: Math.max(1, weight), timestamp }]));
}

export function applyPlanetState(core: CoreState, state: WirePlanetState): void {
  core.planetHistory = state.history;
  core.planetMix = state.mix;
  core.dominantPlanetClass = state.dominant;
  core.secondaryPlanetClass = state.secondary;
}

export function coreToWirePlanetState(core: CoreState): WirePlanetState {
  return {
    history: core.planetHistory,
    mix: core.planetMix,
    dominant: core.dominantPlanetClass,
    secondary: core.secondaryPlanetClass,
  };
}

export function layoutCores(cores: Map<string, CoreState>, selfId: string, viewport: ViewportSize): void {
  const self = cores.get(selfId);
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;

  if (self) {
    self.tx = cx;
    self.ty = cy;
  }

  const peers = [...cores.values()].filter((core) => core.id !== selfId);
  if (!self && peers.length === 1) {
    peers[0]!.tx = cx;
    peers[0]!.ty = cy;
    return;
  }

  const orbit = Math.min(viewport.width, viewport.height) * 0.28;
  peers.forEach((core, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(peers.length, 1);
    core.tx = cx + Math.cos(angle) * orbit;
    core.ty = cy + Math.sin(angle) * orbit;
  });
}

export function reconcileRoster(
  cores: Map<string, CoreState>,
  selfId: string,
  peers: PeerMeta[],
  viewport: ViewportSize,
): void {
  const keep = new Set([selfId, ...peers.map((peer) => peer.id)]);
  for (const peer of peers) ensureCore(cores, peer, viewport);
  for (const id of cores.keys()) {
    if (!keep.has(id)) cores.delete(id);
  }
  layoutCores(cores, selfId, viewport);
}
