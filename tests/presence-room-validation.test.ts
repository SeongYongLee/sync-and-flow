import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../worker/src/room.js";
import { isAuthorizedPublish } from "../worker/src/index.js";
import type { PublishMessage } from "../src/shared/protocol.js";

const validPublish: PublishMessage = {
  kind: "publish",
  userId: "user-1",
  nickname: "User 1",
  color: "#80b4ff",
  source: "codex",
  provider: "openai",
  model: "gpt-5-codex",
  delta: {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 3,
  },
  totals: {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 3,
    turns: 1,
    totalUsd: 0,
  },
  energy: 20.3,
  timestamp: "2026-05-12T00:00:00.000Z",
};

describe("parseClientMessage", () => {
  it("accepts a valid publish payload", () => {
    expect(parseClientMessage(JSON.stringify(validPublish))).toEqual(validPublish);
  });

  it("accepts pi publish payloads over the shared network protocol", () => {
    expect(parseClientMessage(JSON.stringify({ ...validPublish, source: "pi", model: "pi-agent" }))).toEqual({
      ...validPublish,
      source: "pi",
      model: "pi-agent",
    });
  });

  it("rejects malformed or unknown messages", () => {
    expect(parseClientMessage("{")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ kind: "delete-room" }))).toBeNull();
  });

  it("rejects publish payloads with invalid source, color, or numeric fields", () => {
    expect(parseClientMessage(JSON.stringify({ ...validPublish, source: "unknown" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...validPublish, color: "red" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...validPublish, energy: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...validPublish, delta: { ...validPublish.delta, outputTokens: -1 } }))).toBeNull();
  });

  it("accepts subscribe and ping with bounded identity fields", () => {
    expect(parseClientMessage(JSON.stringify({ kind: "subscribe", userId: "me", nickname: "Me", color: "#ffffff" }))).toEqual({
      kind: "subscribe",
      userId: "me",
      nickname: "Me",
      color: "#ffffff",
    });
    expect(parseClientMessage(JSON.stringify({ kind: "ping", userId: "me" }))).toEqual({ kind: "ping", userId: "me" });
  });
});

describe("publish authorization", () => {
  it("allows publish when no token is configured", () => {
    expect(isAuthorizedPublish(new Request("https://example.com/publish"), undefined)).toBe(true);
  });

  it("requires a matching query or bearer token when configured", () => {
    expect(isAuthorizedPublish(new Request("https://example.com/publish"), "secret")).toBe(false);
    expect(isAuthorizedPublish(new Request("https://example.com/publish?token=secret"), "secret")).toBe(true);
    expect(isAuthorizedPublish(new Request("https://example.com/publish", { headers: { Authorization: "Bearer secret" } }), "secret")).toBe(true);
  });
});
