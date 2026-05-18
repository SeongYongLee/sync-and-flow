import { describe, expect, it } from "vitest";
import { samplePeers } from "../worker/src/sample.js";
import type { PeerMeta } from "../src/shared/protocol.js";

function users(count: number): Map<string, PeerMeta> {
  return new Map(
    Array.from({ length: count }, (_, i) => [
      `user-${i}`,
      { id: `user-${i}`, nickname: `user-${i}`, color: "#fff", lastSeen: Date.now() },
    ]),
  );
}

describe("samplePeers", () => {
  it("excludes the viewer", () => {
    expect(samplePeers("user-0", users(3)).map((peer) => peer.id)).toEqual(["user-1", "user-2"]);
  });

  it("caps peer roster at four users", () => {
    expect(samplePeers("user-0", users(8))).toHaveLength(4);
  });

  it("keeps previous roster overlap when possible", () => {
    const sampled = samplePeers("user-0", users(8), new Set(["user-2", "user-3", "user-4"]));
    expect(sampled.some((peer) => peer.id === "user-2" || peer.id === "user-3")).toBe(true);
  });
});
