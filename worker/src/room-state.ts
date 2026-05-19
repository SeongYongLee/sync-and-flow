import { samplePeers } from "./sample.js";
import { classifyPlanet, recordPlanetStateUse, type WirePlanetState } from "../../src/shared/planet.js";
import type { PeerMeta, PresenceSnapshotMessage, PublishMessage, RosterMessage, SubscribeMessage, TurnMessage } from "../../src/shared/protocol.js";

export const STALE_MS = 30_000;

export interface SendSocket {
  send(message: string): void;
}

interface ViewerState {
  viewerId: string;
  ws: SendSocket;
  visiblePeers: Set<string>;
}

export class PresenceRoomState {
  private activeUsers = new Map<string, PeerMeta>();
  private publishers = new Map<string, SendSocket>();
  private viewers = new Set<ViewerState>();
  private latestTurns = new Map<string, TurnMessage>();
  private planetStates = new Map<string, WirePlanetState>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  publish(ws: SendSocket | null, message: PublishMessage): void {
    this.upsertUser(message.userId, message.nickname, message.color);
    if (ws) this.publishers.set(message.userId, ws);
    this.refreshRosters();

    const planetState = recordPlanetStateUse(
      message.planetState ?? this.planetStates.get(message.userId),
      classifyPlanet(message.source, message.model),
      message.delta.outputTokens,
      this.now(),
    );
    this.planetStates.set(message.userId, planetState);

    const turn: TurnMessage = { ...message, kind: "turn", planetState };
    this.latestTurns.set(message.userId, turn);
    for (const viewer of this.viewers) {
      if (viewer.viewerId === message.userId || viewer.visiblePeers.has(message.userId)) {
        safeSend(viewer.ws, turn);
      }
    }
  }

  subscribe(ws: SendSocket, message: SubscribeMessage): void {
    const previous = this.findViewerBySocket(ws)?.visiblePeers;
    const peers = samplePeers(message.userId, this.activeUsers, previous);
    const viewer = { viewerId: message.userId, ws, visiblePeers: new Set(peers.map((peer) => peer.id)) };
    this.viewers.add(viewer);
    this.sendRoster(viewer, peers);
    this.replayLatestTurns(viewer);
  }

  ping(message: { userId: string; nickname?: string; color?: string }): void {
    this.upsertUser(message.userId, message.nickname ?? "anonymous", message.color ?? "#80b4ff");
    this.refreshRosters();
  }

  close(ws: SendSocket): void {
    let rosterChanged = false;

    for (const viewer of this.viewers) {
      if (viewer.ws === ws) {
        this.viewers.delete(viewer);
        if (!this.publishers.has(viewer.viewerId) && !this.hasViewerForUser(viewer.viewerId)) {
          this.activeUsers.delete(viewer.viewerId);
          this.latestTurns.delete(viewer.viewerId);
          this.planetStates.delete(viewer.viewerId);
          rosterChanged = true;
        }
      }
    }

    for (const [userId, publisher] of this.publishers) {
      if (publisher === ws) this.publishers.delete(userId);
    }

    if (rosterChanged) this.refreshRosters();
  }

  pruneStale(): void {
    const cutoff = this.now() - STALE_MS;
    for (const [userId, user] of this.activeUsers) {
      if ((user.lastSeen ?? 0) < cutoff) {
        this.activeUsers.delete(userId);
        this.publishers.delete(userId);
        this.latestTurns.delete(userId);
        this.planetStates.delete(userId);
      }
    }
  }

  refreshRosters(): void {
    this.pruneStale();
    for (const viewer of this.viewers) {
      const peers = samplePeers(viewer.viewerId, this.activeUsers, viewer.visiblePeers);
      viewer.visiblePeers = new Set(peers.map((peer) => peer.id));
      this.sendRoster(viewer, peers);
    }
  }

  private upsertUser(userId: string, nickname: string, color: string): void {
    this.activeUsers.set(userId, { id: userId, nickname, color, lastSeen: this.now() });
  }

  private sendRoster(viewer: ViewerState, peers: PeerMeta[]): void {
    const message: RosterMessage = { kind: "roster", viewerId: viewer.viewerId, peers, viewerCount: this.viewers.size };
    safeSend(viewer.ws, message);
  }

  private replayLatestTurns(viewer: ViewerState): void {
    const visibleUserIds = new Set([viewer.viewerId, ...viewer.visiblePeers]);
    for (const userId of visibleUserIds) {
      const turn = this.latestTurns.get(userId);
      if (turn) safeSend(viewer.ws, snapshotFromTurn(turn));
    }
  }

  private findViewerBySocket(ws: SendSocket): ViewerState | undefined {
    for (const viewer of this.viewers) {
      if (viewer.ws === ws) return viewer;
    }
    return undefined;
  }

  private hasViewerForUser(userId: string): boolean {
    for (const viewer of this.viewers) {
      if (viewer.viewerId === userId) return true;
    }
    return false;
  }
}

function snapshotFromTurn(turn: TurnMessage): PresenceSnapshotMessage {
  const { delta: _delta, kind: _kind, ...rest } = turn;
  return { ...rest, kind: "snapshot" };
}

function safeSend(ws: SendSocket, message: unknown): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Dead sockets are removed on close/error by the owner.
  }
}
