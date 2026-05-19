import { getPresenceIdentityResult } from "./identity.js";
import { connectStream, type SnapshotEvent, type TurnEvent } from "./stream-client.js";
import { connectPresence } from "./ws-client.js";
import { setupMobileQr } from "./mobile-qr.js";
import { setupFlowLinkPrompt } from "./flow-link.js";
import { setupDiagnostics } from "./diagnostics.js";
import { GridLayer } from "./grid.js";
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
import type { PeerMeta, PresenceSnapshotMessage, TurnMessage, WorkerToBrowserMessage } from "../shared/protocol.js";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const hud = new HudController();
const coreRenderer = new CoreRenderer(ctx);
const particles = new ParticleSystem();
const cores = new Map<string, CoreState>();
const grid = new GridLayer();
let selfId = "";
let isViewerOnly = false;
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
  reconcileRoster(cores, selfId, peers, viewport());
}

function drawGrid() {
  grid.drawTo(ctx);
}

function calcTargetZoom(): number {
  const self = cores.get(selfId);
  if (!self) return 1;
  const rawR = displayCoreRadius(self, true, viewport(), false);
  const cap = Math.min(canvas.width, canvas.height) * 0.12;
  return rawR > cap ? Math.max(0.25, cap / rawR) : 1;
}

function tick(now = performance.now()) {
  const frameScale = Math.min(Math.max((now - lastFrameAt) / 16.67, 0.5), 2);
  lastFrameAt = now;

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

  drawGrid();

  const size = viewport();
  for (const core of cores.values()) {
    coreRenderer.draw(core, { selfId, viewport: size, frameScale, currentZoom });
  }

  particles.draw(ctx, cores, frameScale);

  ctx.restore();

  requestAnimationFrame(tick);
}

function applyTurn(ownerId: string, event: TurnEvent | TurnMessage) {
  const dedupKey = turnDedupKey(ownerId, event);
  if (seenTurns.has(dedupKey)) return;
  seenTurns.add(dedupKey);
  if (seenTurns.size > 500) seenTurns.delete(seenTurns.values().next().value as string);
  applyTurnEvent(ownerId, event, { cores, particles, hud, selfId, viewport: viewport(), shouldUpdateHud });
}

function applySnapshot(ownerId: string, event: SnapshotEvent | PresenceSnapshotMessage) {
  applySnapshotEvent(ownerId, event, { cores, hud, selfId, viewport: viewport(), shouldUpdateHud });
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
  setupDiagnostics();
  const { identity, mode } = await getPresenceIdentityResult();
  setupFlowLinkPrompt(mode);
  selfId = identity.userId;
  isViewerOnly = mode !== "local-bridge";
  if (mode === "local-bridge") {
    ensureCore({ id: identity.userId, nickname: identity.nickname, color: identity.color });
  }
  layoutCores();

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

  if (mode === "local-bridge") {
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
