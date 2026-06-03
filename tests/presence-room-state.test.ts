import { describe, expect, it } from "vitest";
import { PresenceRoomState, STALE_MS, type SendSocket } from "../worker/src/room-state.js";
import type { PublishMessage, SubscribeMessage, WorkerToBrowserMessage } from "../src/shared/protocol.js";

class FakeSocket implements SendSocket {
  messages: WorkerToBrowserMessage[] = [];

  send(message: string): void {
    this.messages.push(JSON.parse(message) as WorkerToBrowserMessage);
  }
}

function subscribe(userId: string): SubscribeMessage {
  return {
    kind: "subscribe",
    userId,
    nickname: userId,
    color: userId === "me" ? "#80b4ff" : "#ffb050",
  };
}

function publish(userId: string, outputTokens = 12): PublishMessage {
  return {
    kind: "publish",
    userId,
    nickname: userId,
    color: userId === "me" ? "#80b4ff" : "#ffb050",
    source: userId === "peer" ? "codex" : "claude",
    provider: userId === "peer" ? "openai" : "anthropic",
    model: userId === "peer" ? "gpt-5-codex" : "claude-sonnet-4-6",
    delta: {
      inputTokens: 1,
      outputTokens,
      cacheReadTokens: 0,
    },
    totals: {
      inputTokens: 1,
      outputTokens,
      cacheReadTokens: 0,
      turns: 1,
      totalUsd: 0,
    },
    energy: outputTokens,
    timestamp: "2026-05-12T00:00:00.000Z",
  };
}

function lastRoster(socket: FakeSocket) {
  for (let i = socket.messages.length - 1; i >= 0; i--) {
    const message = socket.messages[i]!;
    if (message.kind === "roster") return message;
  }
  return undefined;
}

describe("PresenceRoomState", () => {
  it("sends rosters that exclude the subscribing viewer", () => {
    const state = new PresenceRoomState();
    const me = new FakeSocket();
    const peer = new FakeSocket();

    state.subscribe(me, subscribe("me"));
    state.subscribe(peer, subscribe("peer"));
    state.ping({ userId: "me", nickname: "me", color: "#80b4ff" });
    state.ping({ userId: "peer", nickname: "peer", color: "#ffb050" });

    expect(lastRoster(me)).toMatchObject({
      kind: "roster",
      viewerId: "me",
      peers: [{ id: "peer" }],
    });
    expect(lastRoster(peer)).toMatchObject({
      kind: "roster",
      viewerId: "peer",
      peers: [{ id: "me" }],
    });
  });

  it("broadcasts a turn to the owner and visible peers only", () => {
    const state = new PresenceRoomState();
    const me = new FakeSocket();
    const peer = new FakeSocket();
    const outsider = new FakeSocket();

    state.subscribe(me, subscribe("me"));
    state.subscribe(peer, subscribe("peer"));
    state.subscribe(outsider, subscribe("outsider"));

    state.publish(null, publish("peer", 33));

    expect(me.messages.some((message) => message.kind === "turn" && message.userId === "peer")).toBe(true);
    expect(peer.messages.some((message) => message.kind === "turn" && message.userId === "peer")).toBe(true);
    expect(outsider.messages.some((message) => message.kind === "turn" && message.userId === "peer")).toBe(true);
  });

  it("refreshes rosters when a viewer-only user disconnects", () => {
    const state = new PresenceRoomState();
    const me = new FakeSocket();
    const peer = new FakeSocket();

    state.subscribe(me, subscribe("me"));
    state.subscribe(peer, subscribe("peer"));
    state.close(peer);

    expect(lastRoster(me)).toMatchObject({
      kind: "roster",
      viewerId: "me",
      peers: [],
    });
  });

  it("keeps a publishing user active when its viewer socket closes", () => {
    const state = new PresenceRoomState();
    const me = new FakeSocket();
    const peerViewer = new FakeSocket();
    const peerPublisher = new FakeSocket();

    state.subscribe(me, subscribe("me"));
    state.subscribe(peerViewer, subscribe("peer"));
    state.publish(peerPublisher, publish("peer"));
    state.close(peerViewer);
    state.refreshRosters();

    expect(lastRoster(me)).toMatchObject({
      kind: "roster",
      viewerId: "me",
      peers: [{ id: "peer" }],
    });
  });

  it("keeps multiple viewers with the same user id in sync", () => {
    const state = new PresenceRoomState();
    const app = new FakeSocket();
    const web = new FakeSocket();
    const peer = new FakeSocket();

    state.subscribe(app, subscribe("me"));
    state.subscribe(web, subscribe("me"));
    state.subscribe(peer, subscribe("peer"));
    state.publish(null, publish("peer", 44));

    expect(app.messages.some((message) => message.kind === "turn" && message.userId === "peer")).toBe(true);
    expect(web.messages.some((message) => message.kind === "turn" && message.userId === "peer")).toBe(true);
  });

  it("replaces repeated subscriptions on the same socket", () => {
    const state = new PresenceRoomState();
    const me = new FakeSocket();

    state.subscribe(me, subscribe("me"));
    state.subscribe(me, subscribe("me"));

    expect(lastRoster(me)).toMatchObject({ kind: "roster", viewerCount: 1 });
  });

  it("replays the latest visible snapshot to late subscribers", () => {
    const state = new PresenceRoomState();
    const app = new FakeSocket();
    const web = new FakeSocket();

    state.subscribe(app, subscribe("me"));
    state.publish(null, publish("me", 55));
    state.subscribe(web, subscribe("me"));

    expect(web.messages.some((message) => message.kind === "snapshot" && message.userId === "me" && message.totals.outputTokens === 55)).toBe(true);
  });

  it("attaches authoritative planet state to turns and snapshots", () => {
    const state = new PresenceRoomState();
    const me = new FakeSocket();
    const web = new FakeSocket();

    state.subscribe(me, subscribe("me"));
    state.publish(null, publish("peer", 72));
    const turn = me.messages.find((message) => message.kind === "turn" && message.userId === "peer");
    expect(turn).toMatchObject({ planetState: { dominant: "forge", mix: { forge: 1 } } });

    state.subscribe(web, subscribe("me"));
    const snapshot = web.messages.find((message) => message.kind === "snapshot" && message.userId === "peer");
    expect(snapshot).toMatchObject({ planetState: { dominant: "forge", mix: { forge: 1 } } });
  });

  it("prunes stale users from subsequent rosters", () => {
    let now = 1_000;
    const state = new PresenceRoomState(() => now);
    const me = new FakeSocket();
    const peer = new FakeSocket();

    state.subscribe(me, subscribe("me"));
    state.subscribe(peer, subscribe("peer"));
    state.ping({ userId: "me", nickname: "me", color: "#80b4ff" });
    state.ping({ userId: "peer", nickname: "peer", color: "#ffb050" });

    now += STALE_MS + 1;
    state.ping({ userId: "me", nickname: "me", color: "#80b4ff" });

    expect(lastRoster(me)).toMatchObject({
      kind: "roster",
      viewerId: "me",
      peers: [],
    });
  });
});
