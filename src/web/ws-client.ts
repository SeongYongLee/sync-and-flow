import type { Identity } from "../shared/nickname.js";
import type { SubscribeMessage, WorkerToBrowserMessage } from "../shared/protocol.js";
import { resolveWorkerUrl } from "./runtime-url.js";

export interface PresenceHandlers {
  onMessage(message: WorkerToBrowserMessage): void;
  onStatus(state: "connecting" | "open" | "closed" | "fallback" | "unreachable", detail?: string): void;
}

export interface PresenceOptions {
  announce?: boolean;
}

export function connectPresence(identity: Identity, handlers: PresenceHandlers, options: PresenceOptions = {}): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let retry = 500;
  let timer: number | null = null;
  let heartbeat: number | null = null;
  let connectTimeout: number | null = null;

  const connect = () => {
    if (closed) return;
    const baseUrl = resolveWorkerUrl();
    handlers.onStatus("connecting", baseUrl);
    ws = new WebSocket(`${baseUrl.replace(/\/$/, "")}/watch`);
    connectTimeout = window.setTimeout(() => {
      if (ws?.readyState !== WebSocket.OPEN) {
        handlers.onStatus("unreachable", baseUrl);
        ws?.close();
      }
    }, 5_000);

    ws.onopen = () => {
      if (connectTimeout !== null) window.clearTimeout(connectTimeout);
      connectTimeout = null;
      retry = 500;
      handlers.onStatus("open", baseUrl);
      const message: SubscribeMessage = { kind: "subscribe", ...identity };
      ws?.send(JSON.stringify(message));
      if (!options.announce) return;
      sendPing();
      heartbeat = window.setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          sendPing();
        }
      }, 10_000);
    };

    ws.onmessage = (event) => {
      try {
        handlers.onMessage(JSON.parse(String(event.data)) as WorkerToBrowserMessage);
      } catch {
        // Ignore malformed worker messages.
      }
    };

    ws.onclose = () => reconnect();
    ws.onerror = () => {
      handlers.onStatus("fallback", baseUrl);
      ws?.close();
    };
  };

  const reconnect = () => {
    if (heartbeat !== null) window.clearInterval(heartbeat);
    if (connectTimeout !== null) window.clearTimeout(connectTimeout);
    heartbeat = null;
    connectTimeout = null;
    if (closed) return;
    handlers.onStatus("closed");
    timer = window.setTimeout(connect, retry);
    retry = Math.min(retry * 1.8, 8_000);
  };

  connect();

  function sendPing() {
    ws?.send(JSON.stringify({ kind: "ping", ...identity }));
  }

  return () => {
    closed = true;
    if (timer !== null) window.clearTimeout(timer);
    if (heartbeat !== null) window.clearInterval(heartbeat);
    if (connectTimeout !== null) window.clearTimeout(connectTimeout);
    ws?.close();
  };
}
