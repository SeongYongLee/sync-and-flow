/// <reference path="./worker-types.d.ts" />

import { PresenceRoomState } from "./room-state.js";
import type { ClientToWorkerMessage } from "../../src/shared/protocol.js";
import type { Provider, SourceId } from "../../src/core/types.js";

const SOURCES = new Set(["claude", "codex", "pi", "cursor-agent", "gemini-cli", "antigravity", "cursor", "claude-desktop", "copilot"]);
const PROVIDERS = new Set(["anthropic", "openai", "google", "github"]);
const MAX_TEXT = 160;
const MAX_TOKEN_COUNT = 1_000_000_000_000;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export class PresenceRoom {
  private state = new PresenceRoomState();

  fetch(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") {
      return this.handlePublishRequest(request);
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    if (url.pathname !== "/publish" && url.pathname !== "/watch") {
      return new Response("Not found", { status: 404 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    server.addEventListener("message", (event) => this.handleMessage(url.pathname, server, event));
    server.addEventListener("close", () => this.handleClose(server));
    server.addEventListener("error", () => this.handleClose(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handlePublishRequest(request: Request): Promise<Response> {
    const message = parseClientMessage(await request.text());
    if (!message || message.kind !== "publish") {
      return new Response("Invalid publish payload", { status: 400 });
    }

    this.state.publish(null, message);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  private handleMessage(pathname: string, ws: WebSocket, event: MessageEvent): void {
    const message = parseClientMessage(event.data);
    if (!message) return;

    this.state.pruneStale();

    if (pathname === "/publish" && message.kind === "publish") {
      this.state.publish(ws, message);
      return;
    }

    if (pathname === "/watch" && message.kind === "subscribe") {
      this.state.subscribe(ws, message);
      return;
    }

    if (message.kind === "ping") {
      this.state.ping(message);
    }
  }

  private handleClose(ws: WebSocket): void {
    this.state.close(ws);
  }
}

export function parseClientMessage(data: unknown): ClientToWorkerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const message = JSON.parse(data) as unknown;
    if (!isRecord(message)) return null;
    if (message["kind"] === "subscribe") return parseSubscribe(message);
    if (message["kind"] === "ping") return parsePing(message);
    if (message["kind"] === "publish") return parsePublish(message);
    return null;
  } catch {
    return null;
  }
}

function parseSubscribe(message: Record<string, unknown>): ClientToWorkerMessage | null {
  const userId = boundedString(message["userId"]);
  const nickname = boundedString(message["nickname"]);
  const color = colorString(message["color"]);
  if (!userId || !nickname || !color) return null;
  return { kind: "subscribe", userId, nickname, color };
}

function parsePing(message: Record<string, unknown>): ClientToWorkerMessage | null {
  const userId = boundedString(message["userId"]);
  if (!userId) return null;

  const nickname = optionalBoundedString(message["nickname"]);
  const color = optionalColorString(message["color"]);
  if (nickname === null || color === null) return null;

  return {
    kind: "ping",
    userId,
    ...(nickname === undefined ? {} : { nickname }),
    ...(color === undefined ? {} : { color }),
  };
}

function parsePublish(message: Record<string, unknown>): ClientToWorkerMessage | null {
  const userId = boundedString(message["userId"]);
  const nickname = boundedString(message["nickname"]);
  const color = colorString(message["color"]);
  const source = sourceString(message["source"]);
  const provider = providerString(message["provider"]);
  const model = boundedString(message["model"]);
  const delta = parseDelta(message["delta"]);
  const totals = parseTotals(message["totals"]);
  const energy = finiteNonNegative(message["energy"]);
  const timestamp = boundedString(message["timestamp"]);

  if (!userId || !nickname || !color || !source || !provider || !model || !delta || !totals || energy === null || !timestamp) {
    return null;
  }

  return {
    kind: "publish",
    userId,
    nickname,
    color,
    source,
    provider,
    model,
    delta,
    totals,
    energy,
    timestamp,
  };
}

function parseDelta(value: unknown) {
  if (!isRecord(value)) return null;
  const outputTokens = integerTokenCount(value["outputTokens"]);
  const inputTokens = integerTokenCount(value["inputTokens"]);
  const cacheReadTokens = integerTokenCount(value["cacheReadTokens"]);
  if (outputTokens === null || inputTokens === null || cacheReadTokens === null) return null;
  return { outputTokens, inputTokens, cacheReadTokens };
}

function parseTotals(value: unknown) {
  if (!isRecord(value)) return null;
  const outputTokens = integerTokenCount(value["outputTokens"]);
  const inputTokens = integerTokenCount(value["inputTokens"]);
  const cacheReadTokens = integerTokenCount(value["cacheReadTokens"]);
  const turns = integerTokenCount(value["turns"]);
  const totalUsd = finiteNonNegative(value["totalUsd"]);
  if (outputTokens === null || inputTokens === null || cacheReadTokens === null || turns === null || totalUsd === null) return null;
  return { outputTokens, inputTokens, cacheReadTokens, turns, totalUsd };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TEXT) return null;
  return trimmed;
}

function optionalBoundedString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return boundedString(value);
}

function colorString(value: unknown): string | null {
  const text = boundedString(value);
  return text && COLOR_RE.test(text) ? text : null;
}

function optionalColorString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return colorString(value);
}

function sourceString(value: unknown): SourceId | null {
  const text = boundedString(value);
  return text && SOURCES.has(text) ? (text as SourceId) : null;
}

function providerString(value: unknown): Provider | null {
  const text = boundedString(value);
  return text && PROVIDERS.has(text) ? (text as Provider) : null;
}

function integerTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_TOKEN_COUNT ? value : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_TOKEN_COUNT ? value : null;
}
