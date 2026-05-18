import { samplePeers } from "./sample.js";
import type { PeerMeta, PublishMessage, RosterMessage, SubscribeMessage, TurnMessage } from "../../src/shared/protocol.js";

export const STALE_MS = 30_000;

export interface SendSocket {
  send(message: string): void;
}

interface ViewerState {
  ws: SendSocket;
  visiblePeers: Set<string>;
}

export class PresenceRoomState {
  private activeUsers = new Map<string, PeerMeta>();
  private publishers = new Map<string, SendSocket>();
  private viewers = new Map<string, ViewerState>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  publish(ws: SendSocket | null, message: PublishMessage): void {
    this.upsertUser(message.userId, message.nickname, message.color);
    if (ws) this.publishers.set(message.userId, ws);
    this.refreshRosters();

    const turn: TurnMessage = { ...message, kind: "turn" };
    for (const [viewerId, viewer] of this.viewers) {
      if (viewerId === message.userId || viewer.visiblePeers.has(message.userId)) {
        safeSend(viewer.ws, turn);
      }
    }
  }

  subscribe(ws: SendSocket, message: SubscribeMessage): void {
    const previous = this.viewers.get(message.userId)?.visiblePeers;
    const peers = samplePeers(message.userId, this.activeUsers, previous);
    this.viewers.set(message.userId, { ws, visiblePeers: new Set(peers.map((peer) => peer.id)) });
    this.sendRoster(message.userId, peers);
  }

  ping(message: { userId: string; nickname?: string; color?: string }): void {
    this.upsertUser(message.userId, message.nickname ?? "anonymous", message.color ?? "#80b4ff");
    this.refreshRosters();
  }

  close(ws: SendSocket): void {
    let rosterChanged = false;

    for (const [viewerId, viewer] of this.viewers) {
      if (viewer.ws === ws) {
        this.viewers.delete(viewerId);
        if (!this.publishers.has(viewerId)) {
          this.activeUsers.delete(viewerId);
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
      }
    }
  }

  refreshRosters(): void {
    this.pruneStale();
    for (const viewerId of this.viewers.keys()) {
      const previous = this.viewers.get(viewerId)?.visiblePeers;
      const peers = samplePeers(viewerId, this.activeUsers, previous);
      const viewer = this.viewers.get(viewerId);
      if (!viewer) continue;
      viewer.visiblePeers = new Set(peers.map((peer) => peer.id));
      this.sendRoster(viewerId, peers);
    }
  }

  private upsertUser(userId: string, nickname: string, color: string): void {
    this.activeUsers.set(userId, { id: userId, nickname, color, lastSeen: this.now() });
  }

  private sendRoster(viewerId: string, peers: PeerMeta[]): void {
    const viewer = this.viewers.get(viewerId);
    if (!viewer) return;
    const message: RosterMessage = { kind: "roster", viewerId, peers };
    safeSend(viewer.ws, message);
  }
}

function safeSend(ws: SendSocket, message: unknown): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Dead sockets are removed on close/error by the owner.
  }
}
