import { fetchBridgeIdentity, getPresenceIdentityResult } from "./identity.js";
import { connectStream, type SnapshotEvent, type TurnEvent } from "./stream-client.js";
import { connectPresence } from "./ws-client.js";
import { setupMobileQr, updateMobileQrAvailability } from "./mobile-qr.js";
import { setupFlowLinkPrompt } from "./flow-link.js";
import { setupDiagnostics } from "./diagnostics.js";
import { DEMO_CORE_ID, createDemoFlowState, ensureDemoFlowCore, nextDemoTurn, removeDemoFlowCore, shouldShowDemoFlow } from "./demo-flow.js";
import { drawFlowBackdrop, GridLayer, gridStepForEnergy } from "./grid.js";
import { HudController } from "./hud.js";
import { CoreRenderer, displayCoreRadius } from "./core-renderer.js";
import {
  ensureCore as ensureCoreState,
  layoutCores as layoutCoreTargets,
  reconcileRoster,
  type CoreState,
} from "./core-state.js";
import { ParticleSystem } from "./particles.js";
import { applySnapshotEvent, applyTurnEvent } from "./turn-events.js";
import { loadProgress, progressToSnapshot, saveSnapshotProgress, saveTurnProgress } from "./progress.js";
import type { PeerMeta, PresenceSnapshotMessage, TurnMessage, WorkerToBrowserMessage } from "../shared/protocol.js";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const demoBadge = document.getElementById("demo-badge")!;

const hud = new HudController();
const coreRenderer = new CoreRenderer(ctx);
const particles = new ParticleSystem();
const cores = new Map<string, CoreState>();
const grid = new GridLayer();
const demoFlow = createDemoFlowState(performance.now());
let selfId = "";
let isViewerOnly = false;
let presenceMode: "local-bridge" | "browser-only" = "browser-only";
let localStreamStarted = false;
let bridgeProbeInFlight = false;
let currentZoom = 1;
let lastFrameAt = performance.now();
const seenTurns = new Set<string>();

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  grid.resize(viewport());
  layoutCores();
}

window.addEventListener("resize", resize);
resize();

function viewport() {
  return { width: canvas.width, height: canvas.height };
}

function ensureCore(peer: PeerMeta): CoreState {
  return ensureCoreState(cores, peer, viewport());
}

function layoutCores() {
  layoutCoreTargets(cores, selfId, viewport());
}

function updateRoster(peers: PeerMeta[]) {
  if (peers.length > 0) removeDemoFlowCore(cores);
  reconcileRoster(cores, selfId, peers, viewport());
}

function drawGrid(energy: number, phase: number) {
  drawFlowBackdrop(ctx, viewport(), energy, phase);
  grid.drawTo(ctx, gridStepForEnergy(energy));
}

function calcTargetZoom(): number {
  const self = cores.get(selfId);
  if (!self) return 1;
  const rawR = displayCoreRadius(self, true, viewport(), false);
  const cap = Math.min(canvas.width, canvas.height) * 0.12;
  return rawR > cap ? Math.max(0.25, cap / rawR) : 1;
}

function currentWorldEnergy(): number {
  const self = cores.get(selfId);
  if (self) return self.energy;

  let maxEnergy = 0;
  for (const core of cores.values()) {
    maxEnergy = Math.max(maxEnergy, core.energy);
  }
  return maxEnergy;
}

function tick(now = performance.now()) {
  const frameScale = Math.min(Math.max((now - lastFrameAt) / 16.67, 0.5), 2);
  lastFrameAt = now;
  updateDemoBadge();
  updateDemoFlow(now);

  ctx.fillStyle = "rgba(8, 6, 20, 0.25)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const zoomEase = 1 - Math.pow(0.97, frameScale);
  currentZoom += (calcTargetZoom() - currentZoom) * zoomEase;

  const scx = canvas.width / 2;
  const scy = canvas.height / 2;
  ctx.save();
  ctx.translate(scx, scy);
  ctx.scale(currentZoom, currentZoom);
  ctx.translate(-scx, -scy);

  drawGrid(currentWorldEnergy(), now);

  const size = viewport();
  const primaryId = primaryRenderCoreId();
  for (const core of cores.values()) {
    coreRenderer.draw(core, { selfId: primaryId, viewport: size, frameScale, currentZoom });
  }

  particles.draw(ctx, particleTargets(size), frameScale);

  ctx.restore();

  requestAnimationFrame(tick);
}

function primaryRenderCoreId(): string {
  return isDemoFlowVisible() ? DEMO_CORE_ID : selfId;
}

function updateDemoBadge(): void {
  demoBadge.hidden = !isDemoFlowVisible();
}

function isDemoFlowVisible(): boolean {
  return shouldShowDemoFlow(presenceMode, cores);
}

function particleTargets(size: { width: number; height: number }) {
  const targets = new Map<string, CoreState & { absorbRadius: number }>();
  for (const core of cores.values()) {
    targets.set(core.id, {
      ...core,
      absorbRadius: displayCoreRadius(core, core.id === selfId || core.id === DEMO_CORE_ID, size, false),
    });
  }
  return targets;
}

function applyTurn(ownerId: string, event: TurnEvent | TurnMessage) {
  removeDemoFlowCore(cores);
  const dedupKey = turnDedupKey(ownerId, event);
  if (seenTurns.has(dedupKey)) return;
  seenTurns.add(dedupKey);
  if (seenTurns.size > 500) seenTurns.delete(seenTurns.values().next().value as string);
  if (applyTurnEvent(ownerId, event, { cores, particles, hud, selfId, viewport: viewport(), shouldUpdateHud }) && ownerId === selfId && "type" in event) {
    const core = cores.get(ownerId);
    if (core) saveTurnProgress(ownerId, event, core);
  }
}

function applySnapshot(ownerId: string, event: SnapshotEvent | PresenceSnapshotMessage) {
  removeDemoFlowCore(cores);
  if (applySnapshotEvent(ownerId, event, { cores, hud, selfId, viewport: viewport(), shouldUpdateHud }) && ownerId === selfId && "type" in event) {
    const core = cores.get(ownerId);
    if (core) saveSnapshotProgress(ownerId, event, core);
  }
}

function updateDemoFlow(now: number): void {
  if (!isDemoFlowVisible()) return;
  ensureDemoFlowCore(cores, viewport());
  const turn = nextDemoTurn(demoFlow, now);
  if (turn) {
    applyTurnEvent(DEMO_CORE_ID, turn, {
      cores,
      particles,
      hud,
      selfId: DEMO_CORE_ID,
      viewport: viewport(),
      now: () => now,
      shouldUpdateHud: (ownerId) => ownerId === DEMO_CORE_ID,
    });
  }
}

async function probeLocalBridge(): Promise<void> {
  if (presenceMode === "local-bridge" || bridgeProbeInFlight) return;
  bridgeProbeInFlight = true;
  try {
    const identity = await fetchBridgeIdentity();
    if (!identity) return;
    updateMobileQrAvailability();
    startLocalBridgeMode({ id: identity.userId, nickname: identity.nickname, color: identity.color });
  } finally {
    bridgeProbeInFlight = false;
  }
}

function startLocalBridgeMode(identity: PeerMeta): void {
  presenceMode = "local-bridge";
  isViewerOnly = false;
  selfId = identity.id;
  removeDemoFlowCore(cores);
  ensureCore(identity);
  layoutCores();
  demoBadge.hidden = true;
  document.getElementById("flow-link-card")?.setAttribute("hidden", "");
  if (localStreamStarted) return;
  localStreamStarted = true;
  connectStream({
    onStatus(state, detail) {
      hud.updateStream(state, detail ?? "");
    },
    onEvent(event) {
      if (event.type === "snapshot") {
        applySnapshot(selfId, event);
        return;
      }
      applyTurn(selfId, event);
    },
  });
}

function shouldUpdateHud(ownerId: string): boolean {
  return ownerId === selfId || isViewerOnly;
}

function onWorkerMessage(message: WorkerToBrowserMessage) {
  if (message.kind === "roster") {
    hud.updateViewerCount(message.viewerCount);
    updateRoster(message.peers);
    return;
  }

  if (message.kind === "turn") {
    if (!isViewerOnly && message.userId === selfId) return;
    ensureCore({ id: message.userId, nickname: message.nickname, color: message.color });
    layoutCores();
    applyTurn(message.userId, message);
    return;
  }

  if (message.kind === "snapshot") {
    ensureCore({ id: message.userId, nickname: message.nickname, color: message.color });
    layoutCores();
    applySnapshot(message.userId, message);
  }
}

async function boot() {
  setupMobileQr();
  const { identity, mode } = await getPresenceIdentityResult();
  updateMobileQrAvailability();
  setupDiagnostics(identity.userId);
  setupFlowLinkPrompt(mode);
  selfId = identity.userId;
  isViewerOnly = mode !== "local-bridge";
  presenceMode = mode;
  if (mode === "local-bridge") {
    startLocalBridgeMode({ id: identity.userId, nickname: identity.nickname, color: identity.color });
  }
  layoutCores();

  const storedProgress = loadProgress(selfId);
  if (storedProgress) {
    removeDemoFlowCore(cores);
    ensureCore({ id: identity.userId, nickname: identity.nickname, color: identity.color });
    layoutCores();
    applySnapshot(selfId, progressToSnapshot(storedProgress));
  }

  connectPresence(
    identity,
    {
      onMessage: onWorkerMessage,
      onStatus(state, detail) {
        hud.updatePresence(state, detail ?? "");
      },
    },
    { announce: mode === "local-bridge" },
  );

  window.setInterval(() => {
    void probeLocalBridge();
  }, 4_000);

  ctx.fillStyle = "rgb(8, 6, 20)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  tick();
}

void boot();

function turnDedupKey(ownerId: string, event: TurnEvent | TurnMessage): string {
  return [
    ownerId,
    event.source,
    event.model,
    event.timestamp,
    event.delta.inputTokens,
    event.delta.outputTokens,
    event.delta.cacheReadTokens,
  ].join(":");
}
