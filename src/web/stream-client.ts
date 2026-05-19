import { resolveBridgeUrl } from "./runtime-url.js";
import type { WirePlanetState } from "../shared/planet.js";

export interface TurnEvent {
  type: "turn";
  source: string;
  provider: string;
  model: string;
  delta: {
    outputTokens: number;
    inputTokens: number;
    cacheReadTokens: number;
  };
  totals: {
    outputTokens: number;
    inputTokens: number;
    cacheReadTokens: number;
    turns: number;
    totalUsd: number;
  };
  sourceTotals?: {
    outputTokens: number;
    inputTokens: number;
    cacheReadTokens: number;
    turns: number;
    totalUsd: number;
  };
  energy: number;
  timestamp: string;
  planetState?: WirePlanetState;
}

export interface SnapshotEvent {
  type: "snapshot";
  model: string;
  source: string;
  totals: {
    outputTokens: number;
    inputTokens: number;
    cacheReadTokens: number;
    turns: number;
    totalUsd: number;
  };
  energy: number;
  timestamp?: string;
  planetState?: WirePlanetState;
}

export type StreamEvent = TurnEvent | SnapshotEvent;
export type EventHandler = (event: StreamEvent) => void;

export interface StreamHandlers {
  onEvent: EventHandler;
  onStatus?(state: "connecting" | "open" | "error", detail?: string): void;
}

export function connectStream(handlers: StreamHandlers): () => void {
  const url = resolveBridgeUrl("/events");
  handlers.onStatus?.("connecting", url);
  const es = new EventSource(url);

  es.onopen = () => {
    handlers.onStatus?.("open", url);
  };

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as StreamEvent;
      if (data.type === "turn" || data.type === "snapshot") handlers.onEvent(data);
    } catch {
      // ignore malformed
    }
  };

  es.onerror = () => {
    handlers.onStatus?.("error", url);
    console.warn("[stream] SSE connection error — retrying...");
  };

  return () => es.close();
}
