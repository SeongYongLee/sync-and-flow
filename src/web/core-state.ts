import type { PeerMeta } from "../shared/protocol.js";

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
    };
    cores.set(peer.id, core);
  }
  core.nickname = peer.nickname;
  core.color = peer.color;
  return core;
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
