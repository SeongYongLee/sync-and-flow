import type { PeerMeta } from "../shared/protocol.js";
import type { PlanetClass } from "./model-visuals.js";

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

const MAX_PLANET_HISTORY = 10;

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
  const boundedWeight = Math.max(1, Math.min(weight, 10_000));
  core.planetHistory.push({ planetClass, weight: boundedWeight, timestamp });
  if (core.planetHistory.length > MAX_PLANET_HISTORY) {
    core.planetHistory.splice(0, core.planetHistory.length - MAX_PLANET_HISTORY);
  }
  summarizePlanetHistory(core);
}

export function resetPlanetUse(core: CoreState, planetClass: PlanetClass, weight: number, timestamp: number): void {
  core.planetHistory = [{ planetClass, weight: Math.max(1, weight), timestamp }];
  summarizePlanetHistory(core);
}

function summarizePlanetHistory(core: CoreState): void {
  const totals: Partial<Record<PlanetClass, number>> = {};
  let totalWeight = 0;
  for (const item of core.planetHistory) {
    totals[item.planetClass] = (totals[item.planetClass] ?? 0) + item.weight;
    totalWeight += item.weight;
  }

  if (totalWeight <= 0) {
    core.planetMix = { drift: 1 };
    core.dominantPlanetClass = "drift";
    core.secondaryPlanetClass = null;
    return;
  }

  const entries = Object.entries(totals)
    .map(([planetClass, weight]) => [planetClass as PlanetClass, weight / totalWeight] as const)
    .sort((a, b) => b[1] - a[1]);

  core.planetMix = Object.fromEntries(entries) as Partial<Record<PlanetClass, number>>;
  core.dominantPlanetClass = entries[0]?.[0] ?? "drift";
  core.secondaryPlanetClass = entries[1]?.[0] ?? null;
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
